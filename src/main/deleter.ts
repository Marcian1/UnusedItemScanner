import type { getStudioProApi } from "@mendix/extensions-api";
import type { DeleteDone, UnusedItem } from "../shared/protocol";

type StudioPro = ReturnType<typeof getStudioProApi>;

const msg = (e: unknown) => (e as any)?.message ?? String(e);

// Children go first: removing an entity also removes its attributes and associations.
const ORDER: Record<UnusedItem["kind"], number> = { attribute: 0, association: 1, entity: 2, document: 3 };

/** True while the element is still present in the (freshly read) domain model. */
async function existsInDomainModel(studioPro: StudioPro, item: UnusedItem): Promise<boolean> {
    const dm: any = await studioPro.app.model.domainModels.getDomainModel(item.moduleName);
    if (!dm) return false;
    if (item.kind === "entity") return (dm.entities ?? []).some((e: any) => e.$ID === item.elementId);
    if (item.kind === "association") {
        return [...(dm.associations ?? []), ...(dm.crossAssociations ?? [])].some((a: any) => a.$ID === item.elementId);
    }
    return (dm.entities ?? []).some((e: any) => (e.attributes ?? []).some((a: any) => a.$ID === item.elementId));
}

async function removeDomainElement(studioPro: StudioPro, item: UnusedItem) {
    if (!(await existsInDomainModel(studioPro, item))) return; // already gone (e.g. removed with its entity)
    const domainModels: any = studioPro.app.model.domainModels;
    let firstError: unknown;

    // 1. Operation based removal
    if (typeof domainModels.applyChanges === "function") {
        try {
            await domainModels.applyChanges([
                {
                    type: "removeElement",
                    unitId: item.unitId,
                    targetId: item.parentId,
                    propertyName: item.propertyName,
                    elementId: item.elementId,
                },
            ]);
            if (!(await existsInDomainModel(studioPro, item))) return;
        } catch (e) {
            firstError = e;
        }
    }

    // 2. Modify the loaded domain model and save it
    try {
        const dm: any = await domainModels.getDomainModel(item.moduleName);
        const keep = (list: any[]) => list.filter((x) => x.$ID !== item.elementId);
        if (item.kind === "entity") dm.entities = keep(dm.entities);
        else if (item.kind === "association") {
            dm.associations = keep(dm.associations ?? []);
            dm.crossAssociations = keep(dm.crossAssociations ?? []);
        } else {
            const entity = dm.entities.find((e: any) => e.$ID === item.parentId);
            if (entity) entity.attributes = keep(entity.attributes);
        }
        await domainModels.save(dm);
        if (!(await existsInDomainModel(studioPro, item))) return;
    } catch (e) {
        firstError ??= e;
    }

    throw new Error(firstError ? msg(firstError) : "Studio Pro did not remove the element");
}

export async function runDelete(
    studioPro: StudioPro,
    items: UnusedItem[],
    report: (done: number, total: number) => void
): Promise<DeleteDone> {
    const model: any = studioPro.app.model;
    const deletedKeys: string[] = [];
    const errors: { key: string; message: string }[] = [];
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
        // let Studio Pro breathe between deletions
        await new Promise((r) => setTimeout(r, 0));
    }
    report(ordered.length, ordered.length);
    return { type: "deleteDone", deletedKeys, errors };
}
