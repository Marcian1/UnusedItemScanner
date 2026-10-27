import type { getStudioProApi } from "@mendix/extensions-api";
import type { ItemKind, ModuleInfo, ScanDone, ScanOptions, UnusedItem } from "../shared/protocol";

type StudioPro = ReturnType<typeof getStudioProApi>;
type Report = (phase: string, done: number, total: number) => void;

// Modules that ship with the platform / well known marketplace modules: never candidates.
const SYSTEM_MODULES = new Set(["System", "Administration", "MxModelReflection", "Mx System", "MxAdmin"]);

type DocType = { accessor: string; label: string; group: string };

// Documents that can be reported as unused. Anything else that the API can load is only
// scanned as a *source* of references (pages, workflows, scheduled events, services ...).
const DOC_TYPES: DocType[] = [
    { accessor: "microflows", label: "Microflow", group: "Microflows" },
    { accessor: "nanoflows", label: "Nanoflow", group: "Nanoflows" },
    { accessor: "rules", label: "Rule", group: "Rules" },
    { accessor: "pages", label: "Page", group: "Pages" },
    { accessor: "snippets", label: "Snippet", group: "Snippets" },
    { accessor: "layouts", label: "Layout", group: "Pages" },
    { accessor: "buildingBlocks", label: "Building block", group: "Pages" },
    { accessor: "pageTemplates", label: "Page template", group: "Pages" },
    { accessor: "javaActions", label: "Java action", group: "Java actions" },
    { accessor: "javaScriptActions", label: "JavaScript action", group: "JavaScript actions" },
    { accessor: "enumerations", label: "Enumeration", group: "Other" },
    { accessor: "constants", label: "Constant", group: "Other" },
    { accessor: "regularExpressions", label: "Regular expression", group: "Other" },
    { accessor: "dataSets", label: "Data set", group: "Other" },
    { accessor: "documentTemplates", label: "Document template", group: "Other" },
    { accessor: "jsonStructures", label: "JSON structure", group: "Other" },
    { accessor: "xmlSchemas", label: "XML schema", group: "Other" },
    { accessor: "importMappings", label: "Import mapping", group: "Other" },
    { accessor: "exportMappings", label: "Export mapping", group: "Other" },
    { accessor: "imageCollections", label: "Image collection", group: "Other" },
    { accessor: "customIconCollections", label: "Icon collection", group: "Other" },
    { accessor: "messageDefinitions", label: "Message definition", group: "Other" },
    { accessor: "messageDefinitions2", label: "Message definition", group: "Other" },
    { accessor: "consumedRestServices", label: "Consumed REST service", group: "Other" },
    { accessor: "consumedODataServices", label: "Consumed OData service", group: "Other" },
    { accessor: "importedWebServices", label: "Consumed web service", group: "Other" },
    { accessor: "databaseConnections", label: "Database connection", group: "Other" },
    { accessor: "queues", label: "Task queue", group: "Other" },
];

// If one of these cannot be read completely, "unused" verdicts are unreliable and nothing is reported.
const CRITICAL = new Set([
    "pages",
    "microflows",
    "nanoflows",
    "rules",
    "snippets",
    "layouts",
    "buildingBlocks",
    "workflows",
]);

// Model parts that never need a load of their own
const NOT_SCANNED = new Set(["domainModels", "projects", "modules", "customBlobDocuments", "files"]);

const CHUNK_SIZE = 40;
const FILE_CONCURRENCY = 8;
const SKIP_KEYS = new Set(["name", "documentation", "text", "caption"]);
const TOKEN = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g;

type Candidate = {
    kind: ItemKind;
    used: boolean;
    qualified: string;
    item: UnusedItem;
    /** attributes: qualified name of the owning entity */
    entityQ?: string;
    /** associations: qualified names of both ends */
    ends?: [string, string];
};

/** What one unit (document, entity part, project file) refers to. */
type Ctx = {
    selfQ?: string;
    /** collect unqualified identifiers (expressions / XPath) to resolve attribute usage */
    trackLoose: boolean;
    loose: Set<string>;
    entities: Set<string>;
    assocs: Set<string>;
};

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const msg = (e: unknown) => (e as any)?.message ?? String(e);

export function isMarketplaceModule(m: { name: string; fromAppStore: boolean }) {
    return m.fromAppStore || SYSTEM_MODULES.has(m.name);
}

export async function listModules(studioPro: StudioPro): Promise<ModuleInfo[]> {
    const modules = await studioPro.app.model.modules.getModules();
    return modules
        .map((m) => ({ name: m.name, fromAppStore: m.fromAppStore, isDefaultSelected: !isMarketplaceModule(m) }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

export async function runScan(
    studioPro: StudioPro,
    options: ScanOptions,
    report: Report,
    isCancelled: () => boolean
): Promise<ScanDone> {
    const started = Date.now();
    const model = studioPro.app.model as any;
    const warnings: string[] = [];
    const cancelledResult = (): ScanDone => ({
        type: "scanDone",
        cancelled: true,
        items: [],
        warnings,
        stats: { unitsScanned: 0, durationMs: Date.now() - started, candidates: 0 },
    });

    // ── Modules ────────────────────────────────────────────────────────────────
    report("Reading modules", 0, 1);
    const modules = await studioPro.app.model.modules.getModules();
    const targetModules = new Set(options.modules);
    const sourceModules = new Set(
        modules.filter((m) => !(options.skipMarketplaceModules && isMarketplaceModule(m))).map((m) => m.name)
    );
    for (const m of targetModules) sourceModules.add(m);

    // ── Candidates + reference lookup tables ──────────────────────────────────
    const qmap = new Map<string, Candidate[]>();
    const attrsByName = new Map<string, Candidate[]>();
    const candidates: Candidate[] = [];
    const allEntities = new Set<string>();
    const entityParent = new Map<string, string>();
    const assocEnds = new Map<string, [string, string]>();

    const register = (c: Candidate) => {
        candidates.push(c);
        const list = qmap.get(c.qualified);
        if (list) list.push(c);
        else qmap.set(c.qualified, [c]);
    };

    // Unit infos of every loadable accessor (cheap, no unit content is loaded yet)
    type Source = { key: string; api: any; ids: Set<string>; total: number };
    const sources: Source[] = [];
    const selfQById = new Map<string, string>();
    const accessorKeys = Object.keys(model).filter(
        (k) => !NOT_SCANNED.has(k) && typeof model[k]?.loadAll === "function" && typeof model[k]?.getUnitsInfo === "function"
    );
    const docTypeByAccessor = new Map(DOC_TYPES.map((d) => [d.accessor, d]));

    for (let i = 0; i < accessorKeys.length; i++) {
        const key = accessorKeys[i];
        report("Collecting documents", i, accessorKeys.length);
        if (isCancelled()) return cancelledResult();
        try {
            const infos = await model[key].getUnitsInfo();
            const ids = new Set<string>();
            const docType = docTypeByAccessor.get(key);
            for (const u of infos) {
                const moduleName = u.moduleName ?? "";
                if (u.name && moduleName) selfQById.set(u.$ID, `${moduleName}.${u.name}`);
                if (sourceModules.has(moduleName)) ids.add(u.$ID);
                if (docType && u.name && targetModules.has(moduleName)) {
                    const qualified = `${moduleName}.${u.name}`;
                    register({
                        kind: "document",
                        used: false,
                        qualified,
                        item: {
                            key: `document:${u.$ID}`,
                            kind: "document",
                            typeLabel: docType.label,
                            group: docType.group,
                            name: u.name,
                            qualifiedName: qualified,
                            moduleName,
                            unitId: u.$ID,
                            elementId: u.$ID,
                            accessor: key,
                        },
                    });
                }
            }
            if (ids.size > 0) sources.push({ key, api: model[key], ids, total: ids.size });
        } catch (e) {
            if (CRITICAL.has(key)) {
                warnings.push(`Could not read ${key} (${msg(e)}).`);
                return failed(warnings, started);
            }
            warnings.push(`Skipped ${key}: ${msg(e)}`);
        }
        await tick();
    }

    // ── Reference collection ──────────────────────────────────────────────────
    const newCtx = (selfQ: string | undefined, trackLoose: boolean): Ctx => ({
        selfQ,
        trackLoose,
        loose: new Set(),
        entities: new Set(),
        assocs: new Set(),
    });

    const hit = (q: string, ctx: Ctx) => {
        if (allEntities.has(q)) ctx.entities.add(q);
        const list = qmap.get(q);
        if (!list) return;
        for (const c of list) {
            if (c.kind === "document" && q === ctx.selfQ) continue; // recursion / self reference
            c.used = true;
            if (c.kind === "association") ctx.assocs.add(q);
            if (c.kind === "attribute" && c.entityQ) ctx.entities.add(c.entityQ);
        }
    };

    const scanString = (s: string, ctx: Ctx) => {
        if (s.length < 2 || s.length > 100_000) return;
        for (const m of s.matchAll(TOKEN)) {
            const t = m[0];
            const d1 = t.indexOf(".");
            if (d1 < 0) {
                if (ctx.trackLoose && t.length > 1) ctx.loose.add(t);
                continue;
            }
            const d2 = t.indexOf(".", d1 + 1);
            if (d2 < 0) {
                hit(t, ctx);
                continue;
            }
            hit(t.slice(0, d2), ctx); // Module.Entity / Module.Enumeration / Module.ImageCollection
            const d3 = t.indexOf(".", d2 + 1);
            hit(d3 < 0 ? t : t.slice(0, d3), ctx); // Module.Entity.Attribute / Module.Enumeration.Value
        }
    };

    const scanTree = (root: unknown, ctx: Ctx) => {
        const stack: unknown[] = [root];
        const seen = new Set<object>();
        while (stack.length) {
            const n = stack.pop();
            if (typeof n === "string") {
                scanString(n, ctx);
                continue;
            }
            if (n === null || typeof n !== "object" || seen.has(n)) continue;
            seen.add(n);
            try {
                if (Array.isArray(n)) {
                    for (const v of n) stack.push(v);
                } else {
                    for (const k of Object.keys(n)) {
                        if (k.charCodeAt(0) === 36 /* $ */ || SKIP_KEYS.has(k)) continue;
                        stack.push((n as any)[k]);
                    }
                }
            } catch {
                // unit parts that cannot be enumerated are skipped
            }
        }
    };

    const finishCtx = (ctx: Ctx) => {
        for (const a of ctx.assocs) {
            const ends = assocEnds.get(a);
            if (ends) ends.forEach((e) => ctx.entities.add(e));
        }
        if (ctx.loose.size === 0) return;
        // Attribute names in expressions/XPath are not qualified: they count as used when the same
        // unit refers to the owning entity (or one of its generalizations).
        const reachable = new Set<string>();
        for (const e of ctx.entities) {
            let cur: string | undefined = e;
            while (cur && !reachable.has(cur)) {
                reachable.add(cur);
                cur = entityParent.get(cur);
            }
        }
        for (const t of ctx.loose) {
            const list = attrsByName.get(t);
            if (!list) continue;
            for (const c of list) if (!c.used && c.entityQ && reachable.has(c.entityQ)) c.used = true;
        }
    };

    // ── Domain models: candidates (target modules) and references (all modules) ──
    const dmModules = modules.filter((m) => sourceModules.has(m.name));
    const dmRegister: Array<() => void> = [];
    const dmScan: Array<() => void> = [];
    for (let i = 0; i < dmModules.length; i++) {
        const mod = dmModules[i];
        report("Reading domain models", i, dmModules.length);
        if (isCancelled()) return cancelledResult();
        try {
            const dm = await model.domainModels.getDomainModel(mod.name);
            if (!dm) continue;
            const isTarget = targetModules.has(mod.name);
            const qualifyEntity = (s: string) => (s.includes(".") ? s : `${mod.name}.${s}`);

            for (const entity of dm.entities ?? []) {
                const entityQ = `${mod.name}.${entity.name}`;
                allEntities.add(entityQ);
                const parent = (entity.generalization as any)?.generalization;
                if (typeof parent === "string" && parent) entityParent.set(entityQ, qualifyEntity(parent));
            }
            for (const list of [dm.associations ?? [], dm.crossAssociations ?? []]) {
                for (const a of list as any[]) {
                    assocEnds.set(`${mod.name}.${a.name}`, [qualifyEntity(a.parent ?? ""), qualifyEntity(a.child ?? "")]);
                }
            }

            // Registration and reference scanning are deferred: every candidate must exist before any
            // domain model is scanned, otherwise references to entities of later modules would be missed.
            dmRegister.push(() => {
                if (!isTarget) return;
                for (const entity of dm.entities ?? []) {
                    const entityQ = `${mod.name}.${entity.name}`;
                    register({
                        kind: "entity",
                        used: false,
                        qualified: entityQ,
                        item: {
                            key: `entity:${entity.$ID}`,
                            kind: "entity",
                            typeLabel: "Entity",
                            group: "Entities",
                            name: entity.name,
                            qualifiedName: entityQ,
                            moduleName: mod.name,
                            unitId: dm.$ID,
                            elementId: entity.$ID,
                            parentId: dm.$ID,
                            propertyName: "entities",
                        },
                    });
                    for (const attr of entity.attributes ?? []) {
                        const attrQ = `${entityQ}.${attr.name}`;
                        const typeName = String((attr.type as any)?.$Type ?? "")
                            .replace("DomainModels$", "")
                            .replace("AttributeType", "");
                        const c: Candidate = {
                            kind: "attribute",
                            used: false,
                            qualified: attrQ,
                            entityQ,
                            item: {
                                key: `attribute:${attr.$ID}`,
                                kind: "attribute",
                                typeLabel: typeName ? `Attribute (${typeName})` : "Attribute",
                                group: "Attributes",
                                name: attr.name,
                                qualifiedName: attrQ,
                                moduleName: mod.name,
                                detail: `Entity ${entity.name}`,
                                unitId: dm.$ID,
                                elementId: attr.$ID,
                                parentId: entity.$ID,
                                propertyName: "attributes",
                            },
                        };
                        register(c);
                        const byName = attrsByName.get(attr.name);
                        if (byName) byName.push(c);
                        else attrsByName.set(attr.name, [c]);
                    }
                }
                const lists: Array<[any[], boolean]> = [
                    [dm.associations ?? [], false],
                    [dm.crossAssociations ?? [], true],
                ];
                for (const [list, isCross] of lists) {
                    for (const a of list) {
                        const q = `${mod.name}.${a.name}`;
                        const ends = assocEnds.get(q)!;
                        const shortName = (e: string) => e.split(".").pop();
                        register({
                            kind: "association",
                            used: false,
                            qualified: q,
                            ends,
                            item: {
                                key: `association:${a.$ID}`,
                                kind: "association",
                                typeLabel: `${isCross ? "Cross-module association" : "Association"} (${
                                    a.type === "ReferenceSet" ? "reference set" : "reference"
                                })`,
                                group: "Associations",
                                name: a.name,
                                qualifiedName: q,
                                moduleName: mod.name,
                                detail: `${shortName(ends[0])} → ${shortName(ends[1])}`,
                                unitId: dm.$ID,
                                elementId: a.$ID,
                                parentId: dm.$ID,
                                propertyName: isCross ? "crossAssociations" : "associations",
                            },
                        });
                    }
                }
            });
            dmScan.push(() => {
                for (const entity of dm.entities ?? []) {
                    const entityQ = `${mod.name}.${entity.name}`;
                    const ctx = newCtx(undefined, false);
                    const parent = entityParent.get(entityQ);
                    if (parent) hit(parent, ctx);
                    scanTree(entity.eventHandlers, ctx);
                    scanTree(entity.source, ctx);
                    for (const attr of entity.attributes ?? []) {
                        scanTree(attr.type, ctx);
                        scanTree(attr.value, ctx);
                    }
                }
            });
        } catch (e) {
            warnings.push(`Could not read the domain model of ${mod.name}: ${msg(e)}`);
        }
        await tick();
    }
    for (const run of dmRegister) run();
    for (const run of dmScan) run();

    // ── Scan all reference sources in batches ─────────────────────────────────
    const total = sources.reduce((n, s) => n + s.total, 0);
    let done = 0;
    for (const source of sources) {
        const ids = [...source.ids];
        let failures = 0;
        for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
            if (isCancelled()) return cancelledResult();
            const chunk = new Set(ids.slice(i, i + CHUNK_SIZE));
            report(`Scanning ${source.key}`, done, total);
            let units: any[] = [];
            try {
                units = await source.api.loadAll((u: any) => chunk.has(u.$ID), chunk.size);
            } catch (e) {
                // Retry one by one so a single broken unit does not hide the rest of the chunk
                for (const id of chunk) {
                    try {
                        units.push(...(await source.api.loadAll((u: any) => u.$ID === id, 1)));
                    } catch {
                        failures++;
                    }
                }
                if (failures === 0) warnings.push(`Retried ${source.key}: ${msg(e)}`);
            }
            for (const unit of units) {
                const ctx = newCtx(selfQById.get(unit?.$ID), true);
                scanTree(unit, ctx);
                finishCtx(ctx);
            }
            done += chunk.size;
            await tick();
        }
        if (failures > 0) {
            const text = `${failures} ${source.key} unit(s) could not be loaded.`;
            if (CRITICAL.has(source.key)) {
                warnings.push(`${text} Without them "unused" results are unreliable, so nothing is reported.`);
                return failed(warnings, started);
            }
            warnings.push(`${text} References from them may be missing.`);
        }
    }

    // ── Navigation and project settings are not exposed by the model API ──────
    if (options.includeNavigationAndSettings) {
        try {
            await scanProjectFiles(studioPro, (text) => {
                const ctx = newCtx(undefined, false);
                scanString(text, ctx);
            }, report, isCancelled);
        } catch (e) {
            warnings.push(
                `Navigation and project settings could not be read (${msg(e)}). ` +
                    `Pages and microflows that are only referenced from there (home pages, menus, after-startup) may be listed as unused.`
            );
        }
        if (isCancelled()) return cancelledResult();
    } else {
        warnings.push(
            "Navigation and project settings were not scanned: pages and microflows only referenced from there are listed as unused."
        );
    }

    // ── Derive results ────────────────────────────────────────────────────────
    report("Evaluating results", total, total);
    // A used association keeps both of its entities alive
    for (const c of candidates) {
        if (c.kind === "association" && c.used && c.ends) {
            for (const end of c.ends) qmap.get(end)?.forEach((e) => e.kind === "entity" && (e.used = true));
        }
    }
    // A used attribute keeps its entity alive
    for (const c of candidates) {
        if (c.kind === "attribute" && c.used && c.entityQ) {
            qmap.get(c.entityQ)?.forEach((e) => e.kind === "entity" && (e.used = true));
        }
    }

    const items = candidates
        .filter((c) => !c.used)
        .map((c) => c.item)
        .sort(
            (a, b) =>
                a.moduleName.localeCompare(b.moduleName) ||
                a.group.localeCompare(b.group) ||
                a.qualifiedName.localeCompare(b.qualifiedName)
        );

    return {
        type: "scanDone",
        cancelled: false,
        items,
        warnings,
        stats: { unitsScanned: done, durationMs: Date.now() - started, candidates: candidates.length },
    };
}

function failed(warnings: string[], started: number): ScanDone {
    return {
        type: "scanDone",
        cancelled: false,
        items: [],
        warnings,
        stats: { unitsScanned: 0, durationMs: Date.now() - started, candidates: 0 },
    };
}

/**
 * Navigation documents and project settings are stored as units in the MPR content folder.
 * They are not reachable through the model API, so their raw text is searched for qualified names.
 */
async function scanProjectFiles(
    studioPro: StudioPro,
    scan: (text: string) => void,
    report: Report,
    isCancelled: () => boolean
) {
    const files = studioPro.app.files;
    let paths: string[] = [];
    for (const pattern of ["mprcontents/**/*.mxunit", "**/*.mxunit", "mprcontents/**"]) {
        paths = await files.getFiles(pattern);
        if (paths.length > 0) break;
    }
    if (paths.length === 0) throw new Error("no mprcontents folder (MPR v1 projects are not supported)");

    let next = 0;
    let read = 0;
    let found = 0;
    const worker = async () => {
        while (next < paths.length && !isCancelled()) {
            const path = paths[next++];
            try {
                const text = await files.getFile(path);
                if (text.includes("Navigation$NavigationDocument") || text.includes("Settings$ProjectSettings")) {
                    found++;
                    scan(text);
                }
            } catch {
                // unreadable files are ignored; the count check below catches systematic failures
            }
            read++;
            if (read % 25 === 0) {
                report("Reading navigation & settings", read, paths.length);
                await tick();
            }
        }
    };
    await Promise.all(Array.from({ length: FILE_CONCURRENCY }, worker));
    if (!isCancelled() && found === 0) throw new Error("navigation document not found in project files");
}
