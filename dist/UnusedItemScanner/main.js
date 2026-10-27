import {
  era
} from "./chunk-WA3LWEMV.js";

// src/main/deleter.ts
var msg = (e) => e?.message ?? String(e);
var ORDER = { attribute: 0, association: 1, entity: 2, document: 3 };
async function existsInDomainModel(studioPro, item) {
  const dm = await studioPro.app.model.domainModels.getDomainModel(item.moduleName);
  if (!dm) return false;
  if (item.kind === "entity") return (dm.entities ?? []).some((e) => e.$ID === item.elementId);
  if (item.kind === "association") {
    return [...dm.associations ?? [], ...dm.crossAssociations ?? []].some((a) => a.$ID === item.elementId);
  }
  return (dm.entities ?? []).some((e) => (e.attributes ?? []).some((a) => a.$ID === item.elementId));
}
async function removeDomainElement(studioPro, item) {
  if (!await existsInDomainModel(studioPro, item)) return;
  const domainModels = studioPro.app.model.domainModels;
  let firstError;
  if (typeof domainModels.applyChanges === "function") {
    try {
      await domainModels.applyChanges([
        {
          type: "removeElement",
          unitId: item.unitId,
          targetId: item.parentId,
          propertyName: item.propertyName,
          elementId: item.elementId
        }
      ]);
      if (!await existsInDomainModel(studioPro, item)) return;
    } catch (e) {
      firstError = e;
    }
  }
  try {
    const dm = await domainModels.getDomainModel(item.moduleName);
    const keep = (list) => list.filter((x) => x.$ID !== item.elementId);
    if (item.kind === "entity") dm.entities = keep(dm.entities);
    else if (item.kind === "association") {
      dm.associations = keep(dm.associations ?? []);
      dm.crossAssociations = keep(dm.crossAssociations ?? []);
    } else {
      const entity = dm.entities.find((e) => e.$ID === item.parentId);
      if (entity) entity.attributes = keep(entity.attributes);
    }
    await domainModels.save(dm);
    if (!await existsInDomainModel(studioPro, item)) return;
  } catch (e) {
    firstError ??= e;
  }
  throw new Error(firstError ? msg(firstError) : "Studio Pro did not remove the element");
}
async function runDelete(studioPro, items, report) {
  const model = studioPro.app.model;
  const deletedKeys = [];
  const errors = [];
  const ordered = [...items].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  for (let i = 0; i < ordered.length; i++) {
    const item = ordered[i];
    report(i, ordered.length);
    try {
      if (item.kind === "document") {
        if (!item.accessor || typeof model[item.accessor]?.deleteUnit !== "function") {
          throw new Error("Unknown document type");
        }
        await model[item.accessor].deleteUnit(item.unitId);
      } else {
        await removeDomainElement(studioPro, item);
      }
      deletedKeys.push(item.key);
    } catch (e) {
      errors.push({ key: item.key, message: `${item.qualifiedName}: ${msg(e)}` });
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  report(ordered.length, ordered.length);
  return { type: "deleteDone", deletedKeys, errors };
}

// src/main/scanner.ts
var SYSTEM_MODULES = /* @__PURE__ */ new Set(["System", "Administration", "MxModelReflection", "Mx System", "MxAdmin"]);
var DOC_TYPES = [
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
  { accessor: "queues", label: "Task queue", group: "Other" }
];
var CRITICAL = /* @__PURE__ */ new Set([
  "pages",
  "microflows",
  "nanoflows",
  "rules",
  "snippets",
  "layouts",
  "buildingBlocks",
  "workflows"
]);
var NOT_SCANNED = /* @__PURE__ */ new Set(["domainModels", "projects", "modules", "customBlobDocuments", "files"]);
var CHUNK_SIZE = 40;
var FILE_CONCURRENCY = 8;
var SKIP_KEYS = /* @__PURE__ */ new Set(["name", "documentation", "text", "caption"]);
var TOKEN = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g;
var tick = () => new Promise((r) => setTimeout(r, 0));
var msg2 = (e) => e?.message ?? String(e);
function isMarketplaceModule(m) {
  return m.fromAppStore || SYSTEM_MODULES.has(m.name);
}
async function listModules(studioPro) {
  const modules = await studioPro.app.model.modules.getModules();
  return modules.map((m) => ({ name: m.name, fromAppStore: m.fromAppStore, isDefaultSelected: !isMarketplaceModule(m) })).sort((a, b) => a.name.localeCompare(b.name));
}
async function runScan(studioPro, options, report, isCancelled) {
  const started = Date.now();
  const model = studioPro.app.model;
  const warnings = [];
  const cancelledResult = () => ({
    type: "scanDone",
    cancelled: true,
    items: [],
    warnings,
    stats: { unitsScanned: 0, durationMs: Date.now() - started, candidates: 0 }
  });
  report("Reading modules", 0, 1);
  const modules = await studioPro.app.model.modules.getModules();
  const targetModules = new Set(options.modules);
  const sourceModules = new Set(
    modules.filter((m) => !(options.skipMarketplaceModules && isMarketplaceModule(m))).map((m) => m.name)
  );
  for (const m of targetModules) sourceModules.add(m);
  const qmap = /* @__PURE__ */ new Map();
  const attrsByName = /* @__PURE__ */ new Map();
  const candidates = [];
  const allEntities = /* @__PURE__ */ new Set();
  const entityParent = /* @__PURE__ */ new Map();
  const assocEnds = /* @__PURE__ */ new Map();
  const register = (c) => {
    candidates.push(c);
    const list = qmap.get(c.qualified);
    if (list) list.push(c);
    else qmap.set(c.qualified, [c]);
  };
  const sources = [];
  const selfQById = /* @__PURE__ */ new Map();
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
      const ids = /* @__PURE__ */ new Set();
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
              accessor: key
            }
          });
        }
      }
      if (ids.size > 0) sources.push({ key, api: model[key], ids, total: ids.size });
    } catch (e) {
      if (CRITICAL.has(key)) {
        warnings.push(`Could not read ${key} (${msg2(e)}).`);
        return failed(warnings, started);
      }
      warnings.push(`Skipped ${key}: ${msg2(e)}`);
    }
    await tick();
  }
  const newCtx = (selfQ, trackLoose) => ({
    selfQ,
    trackLoose,
    loose: /* @__PURE__ */ new Set(),
    entities: /* @__PURE__ */ new Set(),
    assocs: /* @__PURE__ */ new Set()
  });
  const hit = (q, ctx) => {
    if (allEntities.has(q)) ctx.entities.add(q);
    const list = qmap.get(q);
    if (!list) return;
    for (const c of list) {
      if (c.kind === "document" && q === ctx.selfQ) continue;
      c.used = true;
      if (c.kind === "association") ctx.assocs.add(q);
      if (c.kind === "attribute" && c.entityQ) ctx.entities.add(c.entityQ);
    }
  };
  const scanString = (s, ctx) => {
    if (s.length < 2 || s.length > 1e5) return;
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
      hit(t.slice(0, d2), ctx);
      const d3 = t.indexOf(".", d2 + 1);
      hit(d3 < 0 ? t : t.slice(0, d3), ctx);
    }
  };
  const scanTree = (root, ctx) => {
    const stack = [root];
    const seen = /* @__PURE__ */ new Set();
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
            if (k.charCodeAt(0) === 36 || SKIP_KEYS.has(k)) continue;
            stack.push(n[k]);
          }
        }
      } catch {
      }
    }
  };
  const finishCtx = (ctx) => {
    for (const a of ctx.assocs) {
      const ends = assocEnds.get(a);
      if (ends) ends.forEach((e) => ctx.entities.add(e));
    }
    if (ctx.loose.size === 0) return;
    const reachable = /* @__PURE__ */ new Set();
    for (const e of ctx.entities) {
      let cur = e;
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
  const dmModules = modules.filter((m) => sourceModules.has(m.name));
  const dmRegister = [];
  const dmScan = [];
  for (let i = 0; i < dmModules.length; i++) {
    const mod = dmModules[i];
    report("Reading domain models", i, dmModules.length);
    if (isCancelled()) return cancelledResult();
    try {
      const dm = await model.domainModels.getDomainModel(mod.name);
      if (!dm) continue;
      const isTarget = targetModules.has(mod.name);
      const qualifyEntity = (s) => s.includes(".") ? s : `${mod.name}.${s}`;
      for (const entity of dm.entities ?? []) {
        const entityQ = `${mod.name}.${entity.name}`;
        allEntities.add(entityQ);
        const parent = entity.generalization?.generalization;
        if (typeof parent === "string" && parent) entityParent.set(entityQ, qualifyEntity(parent));
      }
      for (const list of [dm.associations ?? [], dm.crossAssociations ?? []]) {
        for (const a of list) {
          assocEnds.set(`${mod.name}.${a.name}`, [qualifyEntity(a.parent ?? ""), qualifyEntity(a.child ?? "")]);
        }
      }
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
              propertyName: "entities"
            }
          });
          for (const attr of entity.attributes ?? []) {
            const attrQ = `${entityQ}.${attr.name}`;
            const typeName = String(attr.type?.$Type ?? "").replace("DomainModels$", "").replace("AttributeType", "");
            const c = {
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
                propertyName: "attributes"
              }
            };
            register(c);
            const byName = attrsByName.get(attr.name);
            if (byName) byName.push(c);
            else attrsByName.set(attr.name, [c]);
          }
        }
        const lists = [
          [dm.associations ?? [], false],
          [dm.crossAssociations ?? [], true]
        ];
        for (const [list, isCross] of lists) {
          for (const a of list) {
            const q = `${mod.name}.${a.name}`;
            const ends = assocEnds.get(q);
            const shortName = (e) => e.split(".").pop();
            register({
              kind: "association",
              used: false,
              qualified: q,
              ends,
              item: {
                key: `association:${a.$ID}`,
                kind: "association",
                typeLabel: `${isCross ? "Cross-module association" : "Association"} (${a.type === "ReferenceSet" ? "reference set" : "reference"})`,
                group: "Associations",
                name: a.name,
                qualifiedName: q,
                moduleName: mod.name,
                detail: `${shortName(ends[0])} \u2192 ${shortName(ends[1])}`,
                unitId: dm.$ID,
                elementId: a.$ID,
                parentId: dm.$ID,
                propertyName: isCross ? "crossAssociations" : "associations"
              }
            });
          }
        }
      });
      dmScan.push(() => {
        for (const entity of dm.entities ?? []) {
          const entityQ = `${mod.name}.${entity.name}`;
          const ctx = newCtx(void 0, false);
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
      warnings.push(`Could not read the domain model of ${mod.name}: ${msg2(e)}`);
    }
    await tick();
  }
  for (const run of dmRegister) run();
  for (const run of dmScan) run();
  const total = sources.reduce((n, s) => n + s.total, 0);
  let done = 0;
  for (const source of sources) {
    const ids = [...source.ids];
    let failures = 0;
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      if (isCancelled()) return cancelledResult();
      const chunk = new Set(ids.slice(i, i + CHUNK_SIZE));
      report(`Scanning ${source.key}`, done, total);
      let units = [];
      try {
        units = await source.api.loadAll((u) => chunk.has(u.$ID), chunk.size);
      } catch (e) {
        for (const id of chunk) {
          try {
            units.push(...await source.api.loadAll((u) => u.$ID === id, 1));
          } catch {
            failures++;
          }
        }
        if (failures === 0) warnings.push(`Retried ${source.key}: ${msg2(e)}`);
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
  if (options.includeNavigationAndSettings) {
    try {
      await scanProjectFiles(studioPro, (text) => {
        const ctx = newCtx(void 0, false);
        scanString(text, ctx);
      }, report, isCancelled);
    } catch (e) {
      warnings.push(
        `Navigation and project settings could not be read (${msg2(e)}). Pages and microflows that are only referenced from there (home pages, menus, after-startup) may be listed as unused.`
      );
    }
    if (isCancelled()) return cancelledResult();
  } else {
    warnings.push(
      "Navigation and project settings were not scanned: pages and microflows only referenced from there are listed as unused."
    );
  }
  report("Evaluating results", total, total);
  for (const c of candidates) {
    if (c.kind === "association" && c.used && c.ends) {
      for (const end of c.ends) qmap.get(end)?.forEach((e) => e.kind === "entity" && (e.used = true));
    }
  }
  for (const c of candidates) {
    if (c.kind === "attribute" && c.used && c.entityQ) {
      qmap.get(c.entityQ)?.forEach((e) => e.kind === "entity" && (e.used = true));
    }
  }
  const items = candidates.filter((c) => !c.used).map((c) => c.item).sort(
    (a, b) => a.moduleName.localeCompare(b.moduleName) || a.group.localeCompare(b.group) || a.qualifiedName.localeCompare(b.qualifiedName)
  );
  return {
    type: "scanDone",
    cancelled: false,
    items,
    warnings,
    stats: { unitsScanned: done, durationMs: Date.now() - started, candidates: candidates.length }
  };
}
function failed(warnings, started) {
  return {
    type: "scanDone",
    cancelled: false,
    items: [],
    warnings,
    stats: { unitsScanned: 0, durationMs: Date.now() - started, candidates: 0 }
  };
}
async function scanProjectFiles(studioPro, scan, report, isCancelled) {
  const files = studioPro.app.files;
  let paths = [];
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

// src/main/index.ts
var component = {
  async loaded(componentContext) {
    if (componentContext.runMode === "headless") {
      return;
    }
    const studioPro = era(componentContext);
    const messaging = studioPro.ui.messagePassing;
    await studioPro.ui.extensionsMenu.add({
      menuId: "UnusedItemScanner.MainMenu",
      caption: "Unused Item Scanner",
      subMenus: [
        {
          menuId: "UnusedItemScanner.ShowMenu",
          caption: "Scan for unused items",
          action: async () => {
            await studioPro.ui.tabs.open(
              { title: "Unused Item Scanner" },
              { componentName: "extension/UnusedItemScanner", uiEntrypoint: "tab" },
              { isSingleton: true }
            );
          }
        }
      ]
    });
    const push = (message) => messaging.sendMessage(message);
    const reply = (messageId, response) => messaging.sendResponse(messageId, response);
    let busy;
    let cancelRequested = false;
    await messaging.addMessageHandler(async ({ messageId, message }) => {
      switch (message.type) {
        case "getModules": {
          try {
            await reply(messageId, { type: "modules", modules: await listModules(studioPro) });
          } catch (e) {
            console.error("[UnusedItemScanner] getModules failed", e);
            await reply(messageId, { type: "modules", modules: [] });
          }
          return;
        }
        case "scan": {
          if (busy) {
            await reply(messageId, { type: "ack", ok: false, error: `A ${busy} is already running.` });
            return;
          }
          busy = "scan";
          cancelRequested = false;
          await reply(messageId, { type: "ack", ok: true });
          void runScan(
            studioPro,
            message.options,
            (phase, done, total) => void push({ type: "scanProgress", phase, done, total }),
            () => cancelRequested
          ).then((result) => push(result)).catch((e) => {
            console.error("[UnusedItemScanner] scan failed", e);
            return push({
              type: "scanDone",
              cancelled: false,
              items: [],
              warnings: [`Scan failed: ${e?.message ?? e}`],
              stats: { unitsScanned: 0, durationMs: 0, candidates: 0 }
            });
          }).finally(() => {
            busy = void 0;
          });
          return;
        }
        case "cancelScan": {
          cancelRequested = true;
          await reply(messageId, { type: "ack", ok: true });
          return;
        }
        case "delete": {
          if (busy) {
            await reply(messageId, { type: "ack", ok: false, error: `A ${busy} is already running.` });
            return;
          }
          busy = "delete";
          await reply(messageId, { type: "ack", ok: true });
          void runDelete(studioPro, message.items, (done, total) => void push({ type: "deleteProgress", done, total })).then((result) => push(result)).catch((e) => {
            console.error("[UnusedItemScanner] delete failed", e);
            return push({
              type: "deleteDone",
              deletedKeys: [],
              errors: [{ key: "", message: `Delete failed: ${e?.message ?? e}` }]
            });
          }).finally(() => {
            busy = void 0;
          });
          return;
        }
        case "open": {
          const { item } = message;
          try {
            if (item.kind === "document") {
              await studioPro.ui.editors.editDocument({ id: item.unitId });
            } else {
              const focusId = item.kind === "attribute" ? item.parentId : item.elementId;
              await studioPro.ui.editors.editDocument({ id: item.unitId }, { id: focusId });
            }
            await reply(messageId, { type: "ack", ok: true });
          } catch (e) {
            console.error("[UnusedItemScanner] open failed", e);
            await reply(messageId, { type: "ack", ok: false, error: e?.message ?? String(e) });
          }
          return;
        }
      }
    });
  }
};
export {
  component
};
//# sourceMappingURL=main.js.map
