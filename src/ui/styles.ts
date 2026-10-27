export const styles = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; overflow-y: auto; }
#root { min-height: 100%; }
body { background: #f4f5f7; color: #1f2430; font: 13px/1.45 "Segoe UI", system-ui, sans-serif; }
.app { display: flex; flex-direction: column; gap: 12px; min-height: 100%; padding: 16px 20px; max-width: 1400px; margin: 0 auto; }
.header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
h1 { margin: 0 0 2px; font-size: 20px; font-weight: 600; }
h2 { margin: 0 0 12px; font-size: 16px; }
.sub, .hint, .muted { margin: 0; color: #667085; }
.hint { font-size: 12px; margin-top: 8px; }
.card { background: #fff; border: 1px solid #e3e6ec; border-radius: 8px; padding: 12px 14px; }
.options { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
.check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap; }
.btn { font: inherit; padding: 6px 14px; border: 1px solid #cfd4dc; background: #fff; color: #1f2430; border-radius: 6px; cursor: pointer; }
.btn:hover:not(:disabled) { background: #f0f2f5; }
.btn:disabled { opacity: .5; cursor: default; }
.btn.primary { background: #2f5bea; border-color: #2f5bea; color: #fff; }
.btn.primary:hover:not(:disabled) { background: #2449c4; }
.btn.danger { background: #d92d20; border-color: #d92d20; color: #fff; }
.btn.danger:hover:not(:disabled) { background: #b42318; }
.btn.small { padding: 3px 12px; }
.link { font: inherit; background: none; border: none; color: #2f5bea; cursor: pointer; padding: 0 6px; }
.link:hover { text-decoration: underline; }
.progress-text { display: flex; justify-content: space-between; margin-bottom: 8px; }
.bar { height: 8px; background: #e8ebf0; border-radius: 4px; overflow: hidden; }
.bar-fill { height: 100%; background: #2f5bea; transition: width .15s; }
.banner { padding: 8px 12px; border-radius: 6px; border: 1px solid; }
.banner ul { margin: 4px 0 0; padding-left: 18px; }
.banner.info { background: #eef4ff; border-color: #c7d7fe; color: #1d3a8a; display: flex; justify-content: space-between; align-items: center; }
.banner.warn { background: #fffaeb; border-color: #fedf89; color: #7a4a05; }
.banner.error { background: #fef3f2; border-color: #fecdca; color: #912018; }
.results { flex: none; height: max(440px, 70vh); display: flex; flex-direction: column; padding: 0; overflow: hidden; }
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #e3e6ec; flex-wrap: wrap; }
.tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.tab { font: inherit; padding: 4px 10px; border: 1px solid transparent; background: none; border-radius: 14px; cursor: pointer; color: #475467; }
.tab:hover { background: #f0f2f5; }
.tab.active { background: #e8eefe; color: #2449c4; border-color: #c7d7fe; }
.count { margin-left: 2px; font-size: 11px; opacity: .75; }
.search { font: inherit; padding: 5px 10px; border: 1px solid #cfd4dc; border-radius: 6px; width: 260px; background: #fff; color: inherit; }
.thead, .row { display: flex; align-items: center; gap: 8px; padding: 0 14px; }
.thead { height: 34px; background: #f9fafb; border-bottom: 1px solid #e3e6ec; font-weight: 600; color: #475467; }
.th-btn { font: inherit; font-weight: 600; background: none; border: none; text-align: left; padding: 0; cursor: pointer; color: inherit; }
.rows { flex: 1; min-height: 120px; overflow-y: auto; position: relative; }
.row { position: absolute; left: 0; right: 0; border-bottom: 1px solid #eef0f3; }
.row:hover { background: #f8f9fb; }
.row.selected { background: #eef4ff; }
.c-check { width: 24px; flex: none; }
.c-type { width: 190px; flex: none; overflow: hidden; }
.c-name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.c-module { width: 170px; flex: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-open { width: 70px; flex: none; text-align: right; }
.name { font-weight: 600; }
.detail { margin-left: 8px; color: #667085; }
.pill { display: inline-block; max-width: 100%; padding: 1px 8px; border-radius: 10px; font-size: 12px; background: #eef0f3; color: #344054; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
.pill-entity, .pill-attribute, .pill-association { background: #e6f4ea; color: #0b5d2a; }
.footer { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-top: 1px solid #e3e6ec; gap: 12px; flex-wrap: wrap; }
.footer-actions { display: flex; gap: 8px; }
.empty { padding: 28px; text-align: center; color: #667085; }
.picker { position: relative; }
.popover { position: absolute; top: 36px; left: 0; z-index: 10; width: 280px; background: #fff; border: 1px solid #cfd4dc; border-radius: 8px; box-shadow: 0 8px 24px rgba(16,24,40,.12); padding: 8px; }
.popover-actions { display: flex; gap: 4px; padding-bottom: 6px; border-bottom: 1px solid #eef0f3; }
.popover-list { max-height: 280px; overflow-y: auto; padding-top: 6px; display: flex; flex-direction: column; gap: 4px; }
.tag { font-size: 10px; padding: 0 6px; border-radius: 8px; background: #eef0f3; color: #667085; }
.overlay { position: fixed; inset: 0; background: rgba(16,24,40,.35); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: #fff; border-radius: 10px; padding: 20px; width: 440px; max-width: calc(100% - 32px); box-shadow: 0 16px 48px rgba(16,24,40,.25); }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.summary { list-style: none; margin: 0 0 4px; padding: 0; }
.summary li { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid #eef0f3; }
`;
