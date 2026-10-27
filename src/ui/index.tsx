import React, { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ComponentContext, IComponent, getStudioProApi } from "@mendix/extensions-api";
import type { ModuleInfo, Push, Request, Response, ScanDone, UnusedItem } from "../shared/protocol";
import { styles } from "./styles";

type Messaging = ReturnType<typeof getStudioProApi>["ui"]["messagePassing"];
type SortKey = "type" | "name" | "module";
type Progress = { phase: string; done: number; total: number };

const ROW_HEIGHT = 44;
const GROUP_ORDER = [
    "Microflows",
    "Nanoflows",
    "Pages",
    "Snippets",
    "Entities",
    "Attributes",
    "Associations",
    "Java actions",
    "JavaScript actions",
    "Rules",
    "Other"
];

export const component: IComponent = {
    async loaded(componentContext: ComponentContext) {
        const messaging = getStudioProApi(componentContext).ui.messagePassing;
        createRoot(document.getElementById("root")!).render(
            <StrictMode>
                <App messaging={messaging} />
            </StrictMode>
        );
    }
};

function request(messaging: Messaging, message: Request): Promise<Response> {
    return new Promise((resolve, reject) => {
        messaging
            .sendMessage<Request, Response>(message, async response => resolve(response))
            .catch(reject);
    });
}

function App({ messaging }: { messaging: Messaging }) {
    const [modules, setModules] = useState<ModuleInfo[]>([]);
    const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set());
    const [includeNav, setIncludeNav] = useState(true);
    const [skipMarketplace, setSkipMarketplace] = useState(false);

    const [scanning, setScanning] = useState(false);
    const [progress, setProgress] = useState<Progress | null>(null);
    const [scanResult, setScanResult] = useState<ScanDone | null>(null);
    const [items, setItems] = useState<UnusedItem[]>([]);

    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [group, setGroup] = useState("All");
    const [search, setSearch] = useState("");
    const [sort, setSort] = useState<{ key: SortKey | null; dir: 1 | -1 }>({ key: null, dir: 1 });

    const [confirming, setConfirming] = useState(false);
    const [deleting, setDeleting] = useState<{ done: number; total: number } | null>(null);
    const [deleteErrors, setDeleteErrors] = useState<string[]>([]);
    const [notice, setNotice] = useState<string | null>(null);

    // ── Messages pushed from the main entry point ────────────────────────────
    useEffect(() => {
        let handlerRef: Awaited<ReturnType<Messaging["addMessageHandler"]>> | undefined;
        let disposed = false;
        messaging
            .addMessageHandler<Push>(async ({ message }) => {
                switch (message.type) {
                    case "scanProgress":
                        setProgress({ phase: message.phase, done: message.done, total: message.total });
                        break;
                    case "scanDone":
                        setScanning(false);
                        setProgress(null);
                        if (!message.cancelled) {
                            setScanResult(message);
                            setItems(message.items);
                            setSelected(new Set());
                            setGroup("All");
                        } else {
                            setNotice("Scan cancelled.");
                        }
                        break;
                    case "deleteProgress":
                        setDeleting({ done: message.done, total: message.total });
                        break;
                    case "deleteDone": {
                        const gone = new Set(message.deletedKeys);
                        setItems(prev => prev.filter(i => !gone.has(i.key)));
                        setSelected(prev => new Set([...prev].filter(k => !gone.has(k))));
                        setDeleteErrors(message.errors.map(e => e.message));
                        setDeleting(null);
                        setNotice(
                            `Deleted ${gone.size} item${gone.size === 1 ? "" : "s"}` +
                                (message.errors.length ? `, ${message.errors.length} failed.` : ".") +
                                " Elements that referenced each other may now be unused – scan again to find them."
                        );
                        break;
                    }
                }
            })
            .then(ref => {
                if (disposed) void messaging.removeMessageHandler(ref);
                else handlerRef = ref;
            });
        return () => {
            disposed = true;
            if (handlerRef) void messaging.removeMessageHandler(handlerRef);
        };
    }, [messaging]);

    useEffect(() => {
        request(messaging, { type: "getModules" }).then(r => {
            if (r.type === "modules") {
                setModules(r.modules);
                setSelectedModules(new Set(r.modules.filter(m => m.isDefaultSelected).map(m => m.name)));
            }
        });
    }, [messaging]);

    // ── Actions ───────────────────────────────────────────────────────────────
    const startScan = async () => {
        setNotice(null);
        setDeleteErrors([]);
        setScanning(true);
        setProgress({ phase: "Starting", done: 0, total: 1 });
        const r = await request(messaging, {
            type: "scan",
            options: {
                modules: [...selectedModules],
                includeNavigationAndSettings: includeNav,
                skipMarketplaceModules: skipMarketplace
            }
        });
        if (r.type === "ack" && !r.ok) {
            setScanning(false);
            setProgress(null);
            setNotice(r.error ?? "The scan could not be started.");
        }
    };

    const cancelScan = () => void request(messaging, { type: "cancelScan" });

    const openItem = async (item: UnusedItem) => {
        const r = await request(messaging, { type: "open", item });
        if (r.type === "ack" && !r.ok) setNotice(`Could not open ${item.qualifiedName}: ${r.error}`);
    };

    const runDelete = async () => {
        setConfirming(false);
        setNotice(null);
        setDeleteErrors([]);
        const toDelete = items.filter(i => selected.has(i.key));
        setDeleting({ done: 0, total: toDelete.length });
        const r = await request(messaging, { type: "delete", items: toDelete });
        if (r.type === "ack" && !r.ok) {
            setDeleting(null);
            setNotice(r.error ?? "The deletion could not be started.");
        }
    };

    // ── Derived data ──────────────────────────────────────────────────────────
    const groupCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const i of items) counts.set(i.group, (counts.get(i.group) ?? 0) + 1);
        return counts;
    }, [items]);

    const groups = useMemo(
        () =>
            [...groupCounts.keys()].sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b)),
        [groupCounts]
    );

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        let list = items.filter(
            i =>
                (group === "All" || i.group === group) &&
                (!q || i.qualifiedName.toLowerCase().includes(q) || i.typeLabel.toLowerCase().includes(q))
        );
        if (sort.key) {
            const pick = (i: UnusedItem) =>
                sort.key === "type" ? i.typeLabel : sort.key === "module" ? i.moduleName : i.name;
            list = [...list].sort((a, b) => pick(a).localeCompare(pick(b)) * sort.dir);
        }
        return list;
    }, [items, group, search, sort]);

    const selectedVisible = visible.filter(i => selected.has(i.key)).length;
    const busy = scanning || deleting !== null;

    // ── Selection ─────────────────────────────────────────────────────────────
    const lastClicked = useRef<number>(-1);
    const toggle = useCallback(
        (index: number, shift: boolean) => {
            setSelected(prev => {
                const next = new Set(prev);
                const target = !prev.has(visible[index].key);
                const [from, to] = shift && lastClicked.current >= 0 ? [lastClicked.current, index].sort((a, b) => a - b) : [index, index];
                for (let i = from; i <= to; i++) {
                    if (target) next.add(visible[i].key);
                    else next.delete(visible[i].key);
                }
                return next;
            });
            lastClicked.current = index;
        },
        [visible]
    );

    const toggleAllVisible = () => {
        setSelected(prev => {
            const next = new Set(prev);
            if (selectedVisible === visible.length) visible.forEach(i => next.delete(i.key));
            else visible.forEach(i => next.add(i.key));
            return next;
        });
    };

    const sortBy = (key: SortKey) =>
        setSort(prev => (prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

    const selectedItems = items.filter(i => selected.has(i.key));
    const hasResult = scanResult !== null;

    return (
        <div className="app">
            <style>{styles}</style>

            <header className="header">
                <div>
                    <h1>Unused Item Scanner</h1>
                    <p className="sub">
                        Finds microflows, nanoflows, pages, snippets, entities, attributes, associations, Java and
                        JavaScript actions and more that nothing refers to.
                    </p>
                </div>
                <div className="actions">
                    {scanning ? (
                        <button className="btn" onClick={cancelScan}>
                            Cancel scan
                        </button>
                    ) : (
                        <button
                            className="btn primary"
                            onClick={startScan}
                            disabled={busy || selectedModules.size === 0}
                        >
                            {hasResult ? "Scan again" : "Scan project"}
                        </button>
                    )}
                </div>
            </header>

            <section className="card options">
                <ModulePicker
                    modules={modules}
                    selected={selectedModules}
                    onChange={setSelectedModules}
                    disabled={busy}
                />
                <label className="check">
                    <input type="checkbox" checked={includeNav} disabled={busy} onChange={e => setIncludeNav(e.target.checked)} />
                    Read navigation &amp; project settings
                </label>
                <label className="check">
                    <input
                        type="checkbox"
                        checked={skipMarketplace}
                        disabled={busy}
                        onChange={e => setSkipMarketplace(e.target.checked)}
                    />
                    Skip marketplace modules as reference sources (faster)
                </label>
            </section>

            {scanning && progress && (
                <section className="card progress">
                    <div className="progress-text">
                        <strong>{progress.phase}</strong>
                        <span>
                            {progress.total > 1 ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}` : ""}
                        </span>
                    </div>
                    <div className="bar">
                        <div
                            className="bar-fill"
                            style={{ width: `${progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 0}%` }}
                        />
                    </div>
                    <p className="hint">The scan runs in small batches in the background; you can keep working in Studio Pro.</p>
                </section>
            )}

            {notice && (
                <div className="banner info">
                    {notice}
                    <button className="link" onClick={() => setNotice(null)}>
                        Dismiss
                    </button>
                </div>
            )}
            {scanResult?.warnings.map((w, i) => (
                <div className="banner warn" key={i}>
                    {w}
                </div>
            ))}
            {deleteErrors.length > 0 && (
                <div className="banner error">
                    <strong>{deleteErrors.length} item(s) could not be deleted:</strong>
                    <ul>
                        {deleteErrors.slice(0, 20).map((e, i) => (
                            <li key={i}>{e}</li>
                        ))}
                        {deleteErrors.length > 20 && <li>… and {deleteErrors.length - 20} more (see the extension console)</li>}
                    </ul>
                </div>
            )}

            {hasResult && !scanning && (
                <section className="card results">
                    <div className="toolbar">
                        <div className="tabs">
                            <Tab label="All" count={items.length} active={group === "All"} onClick={() => setGroup("All")} />
                            {groups.map(g => (
                                <Tab key={g} label={g} count={groupCounts.get(g) ?? 0} active={group === g} onClick={() => setGroup(g)} />
                            ))}
                        </div>
                        <input
                            className="search"
                            type="search"
                            placeholder="Filter by name, module or type…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>

                    {items.length === 0 ? (
                        <div className="empty">Nothing unused was found in the scanned modules. 🎉</div>
                    ) : (
                        <>
                            <div className="thead">
                                <div className="c-check">
                                    <input
                                        type="checkbox"
                                        aria-label="Select all visible"
                                        checked={visible.length > 0 && selectedVisible === visible.length}
                                        ref={el => {
                                            if (el) el.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
                                        }}
                                        onChange={toggleAllVisible}
                                        disabled={busy || visible.length === 0}
                                    />
                                </div>
                                <HeaderCell className="c-type" label="Type" k="type" sort={sort} onSort={sortBy} />
                                <HeaderCell className="c-name" label="Name" k="name" sort={sort} onSort={sortBy} />
                                <HeaderCell className="c-module" label="Module" k="module" sort={sort} onSort={sortBy} />
                                <div className="c-open" />
                            </div>
                            <VirtualRows
                                items={visible}
                                selected={selected}
                                disabled={busy}
                                onToggle={toggle}
                                onOpen={openItem}
                            />
                        </>
                    )}

                    <div className="footer">
                        <span className="muted">
                            {visible.length.toLocaleString()} shown · {selected.size.toLocaleString()} selected
                            {scanResult && (
                                <>
                                    {" "}
                                    · scanned {scanResult.stats.unitsScanned.toLocaleString()} units in{" "}
                                    {(scanResult.stats.durationMs / 1000).toFixed(1)}s
                                </>
                            )}
                        </span>
                        <div className="footer-actions">
                            <button className="btn" disabled={selected.size === 0 || busy} onClick={() => setSelected(new Set())}>
                                Clear selection
                            </button>
                            <button className="btn danger" disabled={selected.size === 0 || busy} onClick={() => setConfirming(true)}>
                                Delete selected ({selected.size.toLocaleString()})
                            </button>
                        </div>
                    </div>
                </section>
            )}

            {!hasResult && !scanning && (
                <section className="card empty">
                    Choose the modules to inspect and press <strong>Scan project</strong>. Nothing is changed until you
                    select items and confirm the deletion.
                </section>
            )}

            {deleting && (
                <Modal>
                    <h2>Deleting…</h2>
                    <div className="bar">
                        <div className="bar-fill" style={{ width: `${(deleting.done / Math.max(1, deleting.total)) * 100}%` }} />
                    </div>
                    <p className="muted">
                        {deleting.done} / {deleting.total}
                    </p>
                </Modal>
            )}

            {confirming && (
                <Modal>
                    <h2>Delete {selectedItems.length.toLocaleString()} item(s)?</h2>
                    <ul className="summary">
                        {groups
                            .map(g => [g, selectedItems.filter(i => i.group === g).length] as const)
                            .filter(([, n]) => n > 0)
                            .map(([g, n]) => (
                                <li key={g}>
                                    <span>{g}</span>
                                    <strong>{n}</strong>
                                </li>
                            ))}
                    </ul>
                    <p className="hint">
                        The scan is static: usages inside Java sources, JavaScript, widgets with custom configuration or
                        other tools are not detected. Review the selection and make sure your project is under version
                        control – Studio Pro&apos;s undo can revert the changes.
                    </p>
                    <div className="modal-actions">
                        <button className="btn" onClick={() => setConfirming(false)}>
                            Cancel
                        </button>
                        <button className="btn danger" onClick={runDelete}>
                            Delete
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    );
}

function Tab(props: { label: string; count: number; active: boolean; onClick: () => void }) {
    return (
        <button className={`tab${props.active ? " active" : ""}`} onClick={props.onClick}>
            {props.label} <span className="count">{props.count.toLocaleString()}</span>
        </button>
    );
}

function HeaderCell(props: {
    className: string;
    label: string;
    k: SortKey;
    sort: { key: SortKey | null; dir: 1 | -1 };
    onSort: (k: SortKey) => void;
}) {
    const active = props.sort.key === props.k;
    return (
        <button className={`${props.className} th-btn`} onClick={() => props.onSort(props.k)}>
            {props.label} {active ? (props.sort.dir === 1 ? "▲" : "▼") : ""}
        </button>
    );
}

function Modal({ children }: { children: React.ReactNode }) {
    return (
        <div className="overlay">
            <div className="modal">{children}</div>
        </div>
    );
}

function ModulePicker(props: {
    modules: ModuleInfo[];
    selected: Set<string>;
    onChange: (s: Set<string>) => void;
    disabled: boolean;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const close = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, []);

    const toggle = (name: string) => {
        const next = new Set(props.selected);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        props.onChange(next);
    };

    return (
        <div className="picker" ref={ref}>
            <button className="btn" disabled={props.disabled} onClick={() => setOpen(o => !o)}>
                Modules: {props.selected.size} of {props.modules.length} ▾
            </button>
            {open && (
                <div className="popover">
                    <div className="popover-actions">
                        <button className="link" onClick={() => props.onChange(new Set(props.modules.map(m => m.name)))}>
                            All
                        </button>
                        <button className="link" onClick={() => props.onChange(new Set())}>
                            None
                        </button>
                        <button
                            className="link"
                            onClick={() => props.onChange(new Set(props.modules.filter(m => m.isDefaultSelected).map(m => m.name)))}
                        >
                            My modules
                        </button>
                    </div>
                    <div className="popover-list">
                        {props.modules.map(m => (
                            <label className="check" key={m.name}>
                                <input type="checkbox" checked={props.selected.has(m.name)} onChange={() => toggle(m.name)} />
                                {m.name}
                                {!m.isDefaultSelected && <span className="tag">marketplace</span>}
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

/** Renders only the rows in view so lists with thousands of results stay responsive. */
function VirtualRows(props: {
    items: UnusedItem[];
    selected: Set<string>;
    disabled: boolean;
    onToggle: (index: number, shift: boolean) => void;
    onOpen: (item: UnusedItem) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [height, setHeight] = useState(400);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new ResizeObserver(() => setHeight(el.clientHeight));
        observer.observe(el);
        setHeight(el.clientHeight);
        return () => observer.disconnect();
    }, []);

    const overscan = 6;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - overscan);
    const end = Math.min(props.items.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + overscan);

    return (
        <div className="rows" ref={ref} onScroll={e => setScrollTop(e.currentTarget.scrollTop)}>
            <div style={{ height: props.items.length * ROW_HEIGHT, position: "relative" }}>
                {props.items.slice(start, end).map((item, offset) => {
                    const index = start + offset;
                    const isSelected = props.selected.has(item.key);
                    return (
                        <div
                            key={item.key}
                            className={`row${isSelected ? " selected" : ""}`}
                            style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
                        >
                            <div className="c-check">
                                <input
                                    type="checkbox"
                                    checked={isSelected}
                                    disabled={props.disabled}
                                    aria-label={`Select ${item.qualifiedName}`}
                                    onChange={() => {}}
                                    onClick={e => props.onToggle(index, e.shiftKey)}
                                />
                            </div>
                            <div className="c-type">
                                <span className={`pill pill-${item.kind}`}>{item.typeLabel}</span>
                            </div>
                            <div className="c-name" title={item.qualifiedName}>
                                <span className="name">{item.name}</span>
                                {item.detail && <span className="detail">{item.detail}</span>}
                            </div>
                            <div className="c-module">{item.moduleName}</div>
                            <div className="c-open">
                                <button className="btn small" onClick={() => props.onOpen(item)} title="Open in Studio Pro">
                                    Open
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
