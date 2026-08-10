(() => {
    "use strict";

    /* ---------------------------------------------------------
       TYPES
    --------------------------------------------------------- */

    type Method =
        | "random"
        | "consistent"
        | "timestamp";

    interface AnonSettings {
        anonymiseByDefault: boolean;
        method: Method;
        randomLength: number;
        consistentName: string;
    }

    interface InputState {
        anonymised: boolean;
    }

    /* ---------------------------------------------------------
       SETTINGS
    --------------------------------------------------------- */

    const settings: AnonSettings = {
        anonymiseByDefault: true,
        method: "random",
        randomLength: 7,
        consistentName: "file"
    };

    /* ---------------------------------------------------------
       STATE
    --------------------------------------------------------- */

    const inputStates =
        new WeakMap<HTMLInputElement, InputState>();

    const originalFiles =
        new WeakMap<HTMLInputElement, File[]>();

    /* ---------------------------------------------------------
       GENERATE NAME
    --------------------------------------------------------- */

    function getExtension(filename: string): string {
        const lastDot = filename.lastIndexOf(".");

        if (
            lastDot <= 0 ||
            lastDot === filename.length - 1
        ) {
            return "";
        }

        return filename.slice(lastDot);
    }

    function generateRandomName(length: number): string {
        const chars =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

        const values = new Uint32Array(length);

        crypto.getRandomValues(values);

        let result = "";

        for (const value of values) {
            result += chars[value % chars.length];
        }

        return result;
    }

    function generateName(
        originalName: string,
        method: Method
    ): string {
        const extension =
            getExtension(originalName);

        switch (method) {
            case "random":
                return (
                    generateRandomName(
                        settings.randomLength
                    ) + extension
                );

            case "consistent":
                return (
                    settings.consistentName +
                    extension
                );

            case "timestamp":
                return (
                    `${Date.now()}${extension}`
                );

            default:
                return originalName;
        }
    }

    /* ---------------------------------------------------------
       CREATE ANONYMOUS FILE
    --------------------------------------------------------- */

    function anonymiseFile(
        file: File
    ): File {
        const newName = generateName(
            file.name,
            settings.method
        );

        return new File(
            [file],
            newName,
            {
                type: file.type,
                lastModified: file.lastModified
            }
        );
    }

    /* ---------------------------------------------------------
       REPLACE INPUT FILES
    --------------------------------------------------------- */

    function setInputFiles(
        input: HTMLInputElement,
        files: File[]
    ): boolean {
        try {
            const dataTransfer =
                new DataTransfer();

            for (const file of files) {
                dataTransfer.items.add(file);
            }

            input.files = dataTransfer.files;

            return true;
        } catch (error) {
            console.warn(
                "[AnonUpload] Unable to replace FileList:",
                error
            );

            return false;
        }
    }

    /* ---------------------------------------------------------
       ANONYMISE INPUT
    --------------------------------------------------------- */

    function anonymiseInput(
        input: HTMLInputElement
    ): void {
        if (!input.files?.length) {
            return;
        }

        const files =
            Array.from(input.files);

        // Keep the original files around so toggling back
        // restores the actual original filenames.
        if (!originalFiles.has(input)) {
            originalFiles.set(
                input,
                files
            );
        }

        const anonymisedFiles =
            files.map(anonymiseFile);

        setInputFiles(
            input,
            anonymisedFiles
        );

        const state =
            inputStates.get(input);

        if (state) {
            state.anonymised = true;
        }
    }

    /* ---------------------------------------------------------
       RESTORE ORIGINAL INPUT
    --------------------------------------------------------- */

    function restoreInput(
        input: HTMLInputElement
    ): void {
        const originals =
            originalFiles.get(input);

        if (!originals) {
            return;
        }

        setInputFiles(
            input,
            originals
        );

        const state =
            inputStates.get(input);

        if (state) {
            state.anonymised = false;
        }
    }

    /* ---------------------------------------------------------
       HANDLE FILE SELECTION
    --------------------------------------------------------- */

    function handleChange(
        event: Event
    ): void {
        const input =
            event.target as HTMLInputElement | null;

        if (
            !input ||
            input.type !== "file" ||
            !input.files?.length
        ) {
            return;
        }

        // Save originals before changing anything.
        originalFiles.set(
            input,
            Array.from(input.files)
        );

        const state =
            inputStates.get(input);

        const shouldAnonymise =
            state?.anonymised ??
            settings.anonymiseByDefault;

        if (shouldAnonymise) {
            anonymiseInput(input);
        }
    }

    /* ---------------------------------------------------------
       TOGGLE BUTTON
    --------------------------------------------------------- */

    function createToggleButton(
        input: HTMLInputElement
    ): HTMLButtonElement {
        const button =
            document.createElement("button");

        button.type = "button";
        button.dataset.anonToggle = "true";

        const state: InputState = {
            anonymised:
                settings.anonymiseByDefault
        };

        inputStates.set(
            input,
            state
        );

        button.style.marginLeft = "0.5rem";

        function updateLabel(): void {
            button.textContent =
                state.anonymised
                    ? "Disable Anonymise"
                    : "Enable Anonymise";
        }

        button.addEventListener(
            "click",
            () => {
                state.anonymised =
                    !state.anonymised;

                if (
                    !input.files?.length
                ) {
                    updateLabel();
                    return;
                }

                if (state.anonymised) {
                    anonymiseInput(input);
                } else {
                    restoreInput(input);
                }

                updateLabel();
            }
        );

        updateLabel();

        return button;
    }

    /* ---------------------------------------------------------
       INITIALIZE INPUT
    --------------------------------------------------------- */

    function initializeInput(
        input: HTMLInputElement
    ): void {
        if (
            input.dataset.anon === "true"
        ) {
            return;
        }

        input.dataset.anon = "true";

        const button =
            createToggleButton(input);

        input.parentNode?.insertBefore(
            button,
            input.nextSibling
        );
    }

    /* ---------------------------------------------------------
       SCAN INPUTS
    --------------------------------------------------------- */

    function scan(
        root: ParentNode = document
    ): void {
        const inputs: HTMLInputElement[] =
            [];

        if (
            root instanceof HTMLInputElement &&
            root.type === "file"
        ) {
            inputs.push(root);
        }

        root
            .querySelectorAll<HTMLInputElement>(
                'input[type="file"]'
            )
            .forEach(input => {
                inputs.push(input);
            });

        for (const input of inputs) {
            initializeInput(input);
        }
    }

    /* ---------------------------------------------------------
       OBSERVER
    --------------------------------------------------------- */

    const observer =
        new MutationObserver(
            mutations => {
                for (const mutation of mutations) {
                    for (
                        const node of mutation.addedNodes
                    ) {
                        if (
                            !(node instanceof Element)
                        ) {
                            continue;
                        }

                        scan(node);
                    }
                }
            }
        );

    /* ---------------------------------------------------------
       INITIALIZE
    --------------------------------------------------------- */

    function initialize(): void {
        scan();

        if (!document.body) {
            return;
        }

        observer.observe(
            document.body,
            {
                childList: true,
                subtree: true
            }
        );

        document.addEventListener(
            "change",
            handleChange
        );

        console.log(
            "[AnonUpload] File anonymisation loaded."
        );
    }

    if (
        document.readyState === "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            { once: true }
        );
    } else {
        initialize();
    }
})();
