import {
    getAllTags,
    getLinkpath,
    iterateCacheRefs,
    Notice,
    Plugin,
    TFile,
    TFolder,
} from "obsidian";
import { DeleteFilesModal } from "./deleteFilesModal";
import { SettingsTab } from "./settingsTab";
import { Utils } from "./utils";

export interface Settings {
    outputFileName: string;
    disableWorkingLinks: boolean;
    directoriesToIgnore: string[];
    filesToIgnore: string[];
    fileTypesToIgnore: string[];
    linksToIgnore: string[];
    tagsToIgnore: string[];
    fileTypesToDelete: string[];
    ignoreFileTypes: boolean;
    ignoreDirectories: boolean;
    unresolvedLinksIgnoreDirectories: boolean;
    unresolvedLinksDirectoriesToIgnore: string[];
    unresolvedLinksFilesToIgnore: string[];
    unresolvedLinksFileTypesToIgnore: string[];
    unresolvedLinksLinksToIgnore: string[];
    unresolvedLinksTagsToIgnore: string[];
    unresolvedLinksOutputFileName: string;
    withoutTagsDirectoriesToIgnore: string[];
    withoutTagsFilesToIgnore: string[];
    withoutTagsOutputFileName: string;
    emptyFilesOutputFileName: string;
    emptyFilesDirectories: string[];
    emptyFilesFilesToIgnore: string[];
    emptyFilesIgnoreDirectories: boolean;
    openOutputFile: boolean;
}
const DEFAULT_SETTINGS: Settings = {
    outputFileName: "orphaned files output",
    disableWorkingLinks: false,
    directoriesToIgnore: [],
    filesToIgnore: [],
    fileTypesToIgnore: [],
    linksToIgnore: [],
    tagsToIgnore: [],
    fileTypesToDelete: [],
    ignoreFileTypes: true,
    ignoreDirectories: true,
    unresolvedLinksIgnoreDirectories: true,
    unresolvedLinksOutputFileName: "broken links output",
    unresolvedLinksDirectoriesToIgnore: [],
    unresolvedLinksFilesToIgnore: [],
    unresolvedLinksFileTypesToIgnore: [],
    unresolvedLinksLinksToIgnore: [],
    unresolvedLinksTagsToIgnore: [],
    withoutTagsDirectoriesToIgnore: [],
    withoutTagsFilesToIgnore: [],
    withoutTagsOutputFileName: "files without tags",
    emptyFilesOutputFileName: "empty files",
    emptyFilesDirectories: [],
    emptyFilesFilesToIgnore: [],
    emptyFilesIgnoreDirectories: true,
    openOutputFile: true,
};

interface BrokenLink {
    link: string;
    files: string[];
}

export default class FindOrphanedFilesPlugin extends Plugin {
    settings: Settings;
    findExtensionRegex = /(\.[^.]+)$/;
    async onload() {
        console.log("loading " + this.manifest.name + " plugin");
        await this.loadSettings();
        this.addCommand({
            id: "find-unlinked-files",
            name: "Find orphaned files",
            callback: () => this.findOrphanedFiles(),
        });
        this.addCommand({
            id: "find-unresolved-link",
            name: "Find broken links",
            callback: () => this.findBrokenLinks(),
        });
        this.addCommand({
            id: "delete-unlinked-files",
            name: "Delete orphaned files with certain extension. See README",
            callback: () => this.deleteOrphanedFiles(),
        });
        this.addCommand({
            id: "create-files-of-broken-links",
            name: "Create files of broken links",
            callback: () => this.createFilesOfBrokenLinks(),
        });
        this.addCommand({
            id: "find-files-without-tags",
            name: "Find files without tags",
            callback: () => this.findFilesWithoutTags(),
        });
        this.addCommand({
            id: "find-empty-files",
            name: "Find empty files",
            callback: () => this.findEmptyFiles(),
        });
        this.addCommand({
            id: "delete-empty-files",
            name: "Delete empty files",
            callback: () => this.deleteEmptyFiles(),
        });
        this.addSettingTab(new SettingsTab(this.app, this, DEFAULT_SETTINGS));

        this.app.workspace.on("file-menu", (menu, file, source, leaf) => {
            if (file instanceof TFolder) {
                menu.addItem((cb) => {
                    cb.setIcon("search");
                    cb.setTitle("Find orphaned files");
                    // Add trailing slash to catch files named like the directory. See https://github.com/Vinzent03/find-unlinked-files/issues/24
                    cb.onClick((e) => {
                        this.findOrphanedFiles(file.path + "/");
                    });
                });
            }
        });
    }

    async createFilesOfBrokenLinks() {
        if (
            !(await this.app.vault.adapter.exists(
                this.settings.unresolvedLinksOutputFileName + ".md"
            ))
        ) {
            new Notice(
                "Can't find file - Please run the `Find broken files' command before"
            );
            return;
        }
        const links = this.app.metadataCache.getCache(
            this.settings.unresolvedLinksOutputFileName + ".md"
        )?.links;
        if (!links) {
            new Notice("No broken links found");
            return;
        }
        const filesToCreate: string[] = [];

        for (const link of links) {
            const file = this.app.metadataCache.getFirstLinkpathDest(
                link.link,
                "/"
            );
            if (file) continue;
            const foundType = this.findExtensionRegex.exec(link.link)?.[0];
            if ((foundType ?? ".md") == ".md") {
                if (foundType) {
                    filesToCreate.push(link.link);
                } else {
                    filesToCreate.push(link.link + ".md");
                }
            }
        }

        if (filesToCreate) {
            for (const file of filesToCreate) {
                await this.app.vault.create(file, "");
            }
        }
    }

    async findEmptyFiles() {
        const files = this.app.vault.getFiles();
        const emptyFiles: TFile[] = [];
        for (const file of files) {
            if (
                !new Utils(
                    this.app,
                    file.path,
                    [],
                    [],
                    this.settings.emptyFilesDirectories,
                    this.settings.emptyFilesFilesToIgnore,
                    this.settings.emptyFilesIgnoreDirectories
                ).isValid()
            ) {
                continue;
            }
            const content = await this.app.vault.read(file);
            const trimmedContent = content.trim();
            if (!trimmedContent) {
                emptyFiles.push(file);
            }
            const cache = this.app.metadataCache.getFileCache(file);
            const frontmatter = cache?.frontmatter;
            if (frontmatter) {
                const lines = content.trimRight().split("\n").length;
                if ((cache.frontmatterPosition ?? frontmatter.position).end.line == lines - 1) {
                    emptyFiles.push(file);
                }
            }
        }
        let prefix: string;
        if (this.settings.disableWorkingLinks) prefix = "	";
        else prefix = "";
        const text = emptyFiles
            .map((file) => `${prefix}- [[${file.path}]]`)
            .join("\n");
        Utils.writeAndOpenFile(
            this.app,
            this.settings.emptyFilesOutputFileName + ".md",
            text,
            this.settings.openOutputFile
        );
    }

    findOrphanedFiles(dir?: string) {
        const outFileName = this.settings.outputFileName + ".md";
        let outFile: TFile;
        const files = this.app.vault.getFiles();
        const markdownFiles = this.app.vault.getMarkdownFiles();
        const links: string[] = [];

        markdownFiles.forEach((markFile: TFile) => {
            if (markFile.path == outFileName) {
                outFile = markFile;
                return;
            }
            iterateCacheRefs(
                this.app.metadataCache.getFileCache(markFile),
                (cb) => {
                    const txt = this.app.metadataCache.getFirstLinkpathDest(
                        getLinkpath(cb.link),
                        markFile.path
                    );
                    if (txt != null) links.push(txt.path);
                }
            );
        });
        const notLinkedFiles = files.filter((file) =>
            this.isValid(file, links, dir)
        );
        notLinkedFiles.remove(outFile);

        let text = "";
        let prefix: string;
        if (this.settings.disableWorkingLinks) prefix = "	";
        else prefix = "";

        notLinkedFiles.sort((a, b) => b.stat.size - a.stat.size);

        notLinkedFiles.forEach((file) => {
            text +=
                prefix +
                "- [[" +
                this.app.metadataCache.fileToLinktext(file, "/", false) +
                "]]\n";
        });
        Utils.writeAndOpenFile(
            this.app,
            outFileName,
            text,
            this.settings.openOutputFile
        );
    }
    async deleteOrphanedFiles() {
        if (
            !(await this.app.vault.adapter.exists(
                this.settings.outputFileName + ".md"
            ))
        ) {
            new Notice(
                "Can't find file - Please run the `Find orphaned files' command before"
            );
            return;
        }
        const links =
            this.app.metadataCache.getCache(
                this.settings.outputFileName + ".md"
            )?.links ?? [];
        const filesToDelete: TFile[] = [];
        links.forEach((link) => {
            const file = this.app.metadataCache.getFirstLinkpathDest(
                link.link,
                "/"
            );
            if (!file) return;

            if (
                this.settings.fileTypesToDelete[0] == "*" ||
                this.settings.fileTypesToDelete.contains(file.extension)
            ) {
                filesToDelete.push(file);
            }
        });
        if (filesToDelete.length > 0)
            new DeleteFilesModal(this.app, filesToDelete).open();
    }

    async deleteEmptyFiles() {
        if (
            !(await this.app.vault.adapter.exists(
                this.settings.emptyFilesOutputFileName + ".md"
            ))
        ) {
            new Notice(
                "Can't find file - Please run the `Find orphaned files' command before"
            );
            return;
        }
        const links =
            this.app.metadataCache.getCache(
                this.settings.emptyFilesOutputFileName + ".md"
            )?.links ?? [];
        const filesToDelete: TFile[] = [];
        for (const link of links) {
            const file = this.app.metadataCache.getFirstLinkpathDest(
                link.link,
                "/"
            );
            if (!file) return;

            filesToDelete.push(file);
        }
        if (filesToDelete.length > 0)
            new DeleteFilesModal(this.app, filesToDelete).open();
    }

    findBrokenLinks() {
        const outFileName = this.settings.unresolvedLinksOutputFileName + ".md";
        const links: BrokenLink[] = [];
        const brokenLinks = this.app.metadataCache.unresolvedLinks;

        for (const sourceFilepath in brokenLinks) {
            if (
                sourceFilepath ==
                this.settings.unresolvedLinksOutputFileName + ".md"
            )
                continue;

            const fileType = sourceFilepath.substring(
                sourceFilepath.lastIndexOf(".") + 1
            );

            const utils = new Utils(
                this.app,
                sourceFilepath,
                this.settings.unresolvedLinksTagsToIgnore,
                this.settings.unresolvedLinksLinksToIgnore,
                this.settings.unresolvedLinksDirectoriesToIgnore,
                this.settings.unresolvedLinksFilesToIgnore,
                this.settings.unresolvedLinksIgnoreDirectories
            );
            if (!utils.isValid()) continue;

            for (const link in brokenLinks[sourceFilepath]) {
                const linkFileType = link.substring(link.lastIndexOf(".") + 1);

                if (
                    this.settings.unresolvedLinksFileTypesToIgnore.contains(
                        linkFileType
                    )
                )
                    continue;

                let formattedFilePath = sourceFilepath;
                if (fileType == "md") {
                    formattedFilePath = sourceFilepath.substring(
                        0,
                        sourceFilepath.lastIndexOf(".md")
                    );
                }
                const brokenLink: BrokenLink = {
                    files: [formattedFilePath],
                    link: link,
                };
                if (links.contains(brokenLink)) continue;
                const duplication = links.find((e) => e.link == link);
                if (duplication) {
                    duplication.files.push(formattedFilePath);
                } else {
                    links.push(brokenLink);
                }
            }
        }
        Utils.writeAndOpenFile(
            this.app,
            outFileName,
            [
                "Don't forget that creating the file from here may create the file in the wrong directory!",
                ...links.map(
                    (e) => `- [[${e.link}]] in [[${e.files.join("]], [[")}]]`
                ),
            ].join("\n"),
            this.settings.openOutputFile
        );
    }

    findFilesWithoutTags() {
        const outFileName = this.settings.withoutTagsOutputFileName + ".md";
        let outFile: TFile;
        const files = this.app.vault.getMarkdownFiles();
        let withoutFiles = files.filter((file) => {
            if (
                new Utils(
                    this.app,
                    file.path,
                    [],
                    [],
                    this.settings.withoutTagsDirectoriesToIgnore,
                    this.settings.withoutTagsFilesToIgnore,
                    true
                ).isValid()
            ) {
                return (
                    (getAllTags(this.app.metadataCache.getFileCache(file))
                        .length ?? 0) <= 0
                );
            } else {
                return false;
            }
        });
        withoutFiles.remove(outFile);

        let prefix: string;
        if (this.settings.disableWorkingLinks) prefix = "	";
        else prefix = "";
        const text = withoutFiles
            .map((file) => `${prefix}- [[${file.path}]]`)
            .join("\n");
        Utils.writeAndOpenFile(
            this.app,
            outFileName,
            text,
            this.settings.openOutputFile
        );
    }

    /**
     * Checks if the given file in an orphaned file
     *
     * @param file file to check
     * @param links all links in the vault
     */
    isValid(file: TFile, links: string[], dir: string): boolean {
        if (links.contains(file.path)) return false;

        //filetypes to ignore by default
        if (file.extension == "css") return false;

        if (this.settings.fileTypesToIgnore[0] !== "") {
            const containsFileType = this.settings.fileTypesToIgnore.contains(
                file.extension
            );
            if (this.settings.ignoreFileTypes) {
                if (containsFileType) return;
            } else {
                if (!containsFileType) return;
            }
        }

        const utils = new Utils(
            this.app,
            file.path,
            this.settings.tagsToIgnore,
            this.settings.linksToIgnore,
            this.settings.directoriesToIgnore,
            this.settings.filesToIgnore,
            this.settings.ignoreDirectories,
            dir
        );
        if (!utils.isValid()) return false;

        return true;
    }

    onunload() {
        console.log("unloading " + this.manifest.name + " plugin");
    }
    async loadSettings() {
        this.settings = Object.assign(DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
