// Messages exchanged between the main entry point (model access) and the UI tab.

export type ItemKind = "document" | "entity" | "attribute" | "association";

export type UnusedItem = {
    /** Unique key in the result list */
    key: string;
    kind: ItemKind;
    /** Human readable type, e.g. "Microflow", "Entity", "Attribute (String)" */
    typeLabel: string;
    /** Filter group shown in the UI tabs */
    group: string;
    name: string;
    qualifiedName: string;
    moduleName: string;
    /** Extra context, e.g. owning entity or association ends */
    detail?: string;
    /** Id of the unit (document or domain model) to open in the editor */
    unitId: string;
    /** Id of the element itself (same as unitId for documents) */
    elementId: string;
    /** Documents: key of the model accessor used for deletion */
    accessor?: string;
    /** Domain model elements: id of the element that holds the removed element's list */
    parentId?: string;
    /** Domain model elements: property name inside the parent */
    propertyName?: string;
};

export type ModuleInfo = { name: string; fromAppStore: boolean; isDefaultSelected: boolean };

export type ScanOptions = {
    modules: string[];
    includeNavigationAndSettings: boolean;
    /** Do not scan marketplace/system modules as sources of references (faster, less accurate) */
    skipMarketplaceModules: boolean;
};

export type Request =
    | { type: "getModules" }
    | { type: "scan"; options: ScanOptions }
    | { type: "cancelScan" }
    | { type: "delete"; items: UnusedItem[] }
    | { type: "open"; item: UnusedItem };

export type Response =
    | { type: "modules"; modules: ModuleInfo[] }
    | { type: "ack"; ok: boolean; error?: string };

// Pushed from main to UI while a long running operation executes
export type ScanProgress = {
    type: "scanProgress";
    phase: string;
    done: number;
    total: number;
};

export type ScanDone = {
    type: "scanDone";
    cancelled: boolean;
    items: UnusedItem[];
    warnings: string[];
    stats: { unitsScanned: number; durationMs: number; candidates: number };
};

export type DeleteProgress = {
    type: "deleteProgress";
    done: number;
    total: number;
};

export type DeleteDone = {
    type: "deleteDone";
    deletedKeys: string[];
    errors: { key: string; message: string }[];
};

export type Push = ScanProgress | ScanDone | DeleteProgress | DeleteDone;
