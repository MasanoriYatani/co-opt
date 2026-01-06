/**
 * DOM Event Handlers Module
 * ドキュメントのDOMContentLoadedイベントとその他のUIイベントハンドラーを管理
 */

import { getOpticalSystemRows, getObjectRows, getSourceRows, outputParaxialDataToDebug, displayCoordinateTransformMatrix } from '../utils/data-utils.js';
import { showSpotDiagram, showTransverseAberrationDiagram, showLongitudinalAberrationDiagram, showAstigmatismDiagram, createFieldSettingFromObject } from '../analysis/optical-analysis.js';
import { updateSurfaceNumberSelect } from './ui-updates.js';
import { generateSurfaceOptions } from '../eva-spot-diagram.js';
import { saveTableData as saveSourceTableData } from '../table-source.js';
import { saveTableData as saveObjectTableData } from '../table-object.js';
import { saveTableData as saveLensTableData } from '../table-optical-system.js';
import { tableSource } from '../table-source.js';
import { tableObject } from '../table-object.js';
import { tableOpticalSystem } from '../table-optical-system.js';
import { debugWASMSystem, quickWASMComparison } from '../debug/debug-utils.js';
import { BLOCK_SCHEMA_VERSION, DEFAULT_STOP_SEMI_DIAMETER, configurationHasBlocks, validateBlocksConfiguration, expandBlocksToOpticalSystemRows, deriveBlocksFromLegacyOpticalSystemRows } from '../block-schema.js';
import { getGlassDataWithSellmeier, findSimilarGlassesByNdVd, findSimilarGlassNames } from '../glass.js';
import { normalizeDesign } from '../normalize-design.js';

// Small shared helpers (used by load/apply flows)

/**
 * @param {{severity?:'fatal'|'warning', phase?:string, message?:string, blockId?:string, surfaceIndex?:number}|any} issue
 * @returns {string}
 */
function formatLoadIssue(issue) {
    if (!issue || typeof issue !== 'object') return String(issue);
    const sev = issue.severity ? String(issue.severity) : 'unknown';
    const phase = issue.phase ? String(issue.phase) : 'unknown';
    const bid = issue.blockId ? ` blockId=${String(issue.blockId)}` : '';
    const si = (issue.surfaceIndex !== undefined && issue.surfaceIndex !== null) ? ` surface=${String(issue.surfaceIndex)}` : '';
    const msg = issue.message ? String(issue.message) : '';
    return `[${sev}](${phase})${bid}${si} ${msg}`.trim();
}

function setLoadWarnUIFlag(enabled) {
    try { window.__cooptLoadHasWarnings = !!enabled; } catch (_) {}
}

function appendLoadWarnToFileNameUI() {
    try {
        const el = document.getElementById('loaded-filename');
        if (!el) return;
        const t = String(el.textContent ?? '');
        if (t.includes('⚠️')) return;
        el.textContent = `${t} ⚠️`;
    } catch (_) {}
}

/**
 * @param {Array<{severity:'fatal'|'warning', phase:'parse'|'normalize'|'validate'|'expand', message:string, blockId?:string, surfaceIndex?:number}>} issues
 * @param {{ filename?: string }} context
 * @returns {boolean} true if no fatal issues
 */
function showLoadErrors(issues, context = {}) {
    const list = Array.isArray(issues) ? issues : [];
    const fatals = list.filter(i => i && i.severity === 'fatal');
    const warnings = list.filter(i => i && i.severity === 'warning');

    if (warnings.length > 0) {
        for (const w of warnings) console.warn('⚠️ [Load]', formatLoadIssue(w));
        setLoadWarnUIFlag(true);
        appendLoadWarnToFileNameUI();
    }

    if (fatals.length === 0) return true;

    for (const f of fatals) console.error('❌ [Load]', formatLoadIssue(f));
    const filename = context.filename ? `\nFile: ${context.filename}` : '';
    const body = fatals.slice(0, 6).map(formatLoadIssue).join('\n');
    const more = fatals.length > 6 ? `\n...and ${fatals.length - 6} more` : '';
    alert(`Load failed.${filename}\n\n${body}${more}`);
    return false;
}

function __blocks_mergeLegacyIndexFieldsIntoExpandedRows(legacyRows, expandedRows) {
    if (!Array.isArray(legacyRows) || !Array.isArray(expandedRows)) return;

    // Object row is not represented in Blocks; preserve user/imported values over schema defaults.
    // Do this even when row counts differ.
    try {
        const findLegacyObjectRow = () => {
            if (legacyRows.length === 0) return null;
            const first = legacyRows[0];
            const t0 = String(first?.['object type'] ?? first?.object ?? '').trim().toLowerCase();
            if (t0 === 'object' || legacyRows[0]?.id === 0) return first;
            for (const r of legacyRows) {
                const t = String(r?.['object type'] ?? r?.object ?? '').trim().toLowerCase();
                if (t === 'object') return r;
            }
            return null;
        };

        const legacyObject = findLegacyObjectRow();
        const expandedObject = expandedRows.length > 0 ? expandedRows[0] : null;
        if (legacyObject && expandedObject && typeof expandedObject === 'object') {
            const ltRaw = legacyObject.thickness;
            const lt = String(ltRaw ?? '').trim();
            if (lt !== '') expandedObject.thickness = ltRaw;

            const lsRaw = legacyObject.semidia;
            const ls = String(lsRaw ?? '').trim();
            if (ls !== '') expandedObject.semidia = lsRaw;
        }
    } catch (_) {}

    // Index-only fields (rindex/abbe) can be merged only when surface indices align.
    if (legacyRows.length !== expandedRows.length) return;
    for (let i = 0; i < expandedRows.length; i++) {
        const legacy = legacyRows[i];
        const row = expandedRows[i];
        if (!legacy || typeof legacy !== 'object' || !row || typeof row !== 'object') continue;

        const lr = String(legacy.rindex ?? '').trim();
        const la = String(legacy.abbe ?? '').trim();
        const rr = String(row.rindex ?? '').trim();
        const ra = String(row.abbe ?? '').trim();
        if (rr === '' && lr !== '') row.rindex = legacy.rindex;
        if (ra === '' && la !== '') row.abbe = legacy.abbe;
    }
}

function __blocks_overlayExpandedProvenanceIntoLegacyRows(legacyRows, expandedRows) {
    if (!Array.isArray(legacyRows) || !Array.isArray(expandedRows)) return;
    if (legacyRows.length === 0 || expandedRows.length === 0) return;

    const copyProv = (src, dst) => {
        if (!src || typeof src !== 'object' || !dst || typeof dst !== 'object') return;
        if ('_blockId' in src) dst._blockId = src._blockId;
        if ('_blockType' in src) dst._blockType = src._blockType;
        if ('_surfaceRole' in src) dst._surfaceRole = src._surfaceRole;
    };

    // Fast path: aligned lengths.
    if (legacyRows.length === expandedRows.length) {
        for (let i = 0; i < legacyRows.length; i++) copyProv(expandedRows[i], legacyRows[i]);
        return;
    }

    const normInf = (v) => {
        const s = String(v ?? '').trim();
        if (s === '') return '';
        if (/^inf(inity)?$/i.test(s)) return 'INF';
        return s.toUpperCase();
    };
    const normMat = (v) => String(v ?? '').trim().toUpperCase();
    const normObjType = (r) => String(r?.['object type'] ?? r?.object ?? '').trim().toLowerCase();

    const isStop = (r) => normObjType(r) === 'stop';
    const isObject = (r) => normObjType(r) === 'object';
    const isImage = (r) => normObjType(r) === 'image';

    const match = (expRow, legacyRow) => {
        if (!expRow || !legacyRow) return false;
        // Keep Object/Image aligned only by type.
        if (isObject(expRow) || isObject(legacyRow)) return isObject(expRow) && isObject(legacyRow);
        if (isImage(expRow) || isImage(legacyRow)) return isImage(expRow) && isImage(legacyRow);
        if (isStop(expRow) || isStop(legacyRow)) return isStop(expRow) && isStop(legacyRow);

        // Surface rows: match loosely by material class and radius.
        const em = normMat(expRow.material);
        const lm = normMat(legacyRow.material);
        const er = normInf(expRow.radius);
        const lr = normInf(legacyRow.radius);

        // Prefer matching by radius, then material (when available).
        if (er && lr && er !== lr) return false;
        if (em && lm && em !== lm) {
            // Allow legacy empty material to match.
            if (lm !== '') return false;
        }
        return true;
    };

    // Greedy subsequence match: walk expanded rows and assign provenance to the next matching legacy row.
    let j = 0;
    for (let i = 0; i < expandedRows.length; i++) {
        const er = expandedRows[i];
        for (; j < legacyRows.length; j++) {
            const lr = legacyRows[j];
            if (match(er, lr)) {
                copyProv(er, lr);
                j++;
                break;
            }
        }
        if (j >= legacyRows.length) break;
    }
}

function __blocks_mergeLegacySemidiaIntoExpandedRows(legacyRows, expandedRows) {
    if (!Array.isArray(legacyRows) || !Array.isArray(expandedRows)) return;
    const n = Math.min(legacyRows.length, expandedRows.length);
    for (let i = 0; i < n; i++) {
        const legacy = legacyRows[i];
        const row = expandedRows[i];
        if (!legacy || typeof legacy !== 'object' || !row || typeof row !== 'object') continue;
        const t = String(row['object type'] ?? row.object ?? '').trim().toLowerCase();
        if (t === 'stop') continue; // Stop semiDiameter should come from Blocks.
        if (t === 'image') continue;
        const lsRaw = legacy.semidia ?? legacy['Semi Diameter'] ?? legacy['semi diameter'] ?? legacy.semiDiameter ?? legacy.semiDia;
        const ls = String(lsRaw ?? '').trim();
        if (ls !== '') row.semidia = lsRaw;
    }
}

let _psfCalculatorSingletonPromise = null;
async function getPSFCalculatorSingleton() {
    if (!_psfCalculatorSingletonPromise) {
        _psfCalculatorSingletonPromise = (async () => {
            const { PSFCalculator } = await import('../eva-psf.js');
            return new PSFCalculator();
        })();
    }
    return _psfCalculatorSingletonPromise;
}

function createCancelToken() {
    return {
        aborted: false,
        reason: null,
        _listeners: [],
        abort(reason = 'User requested stop') {
            if (this.aborted) return;
            this.aborted = true;
            this.reason = reason;
            const ls = Array.isArray(this._listeners) ? this._listeners.slice() : [];
            for (const fn of ls) {
                try { fn(reason); } catch (_) {}
            }
        },
        onAbort(fn) {
            if (typeof fn !== 'function') return;
            if (this.aborted) {
                try { fn(this.reason); } catch (_) {}
                return;
            }
            this._listeners.push(fn);
        }
    };
}

function throwIfCancelled(cancelToken) {
    if (cancelToken && cancelToken.aborted) {
        const err = new Error(String(cancelToken.reason || 'Cancelled'));
        err.code = 'CANCELLED';
        throw err;
    }
}

async function raceWithCancel(promise, cancelToken) {
    if (!cancelToken) return await promise;
    if (cancelToken.aborted) throwIfCancelled(cancelToken);
    let cancelReject = null;
    const cancelPromise = new Promise((_, reject) => {
        cancelReject = reject;
        cancelToken.onAbort((reason) => {
            const err = new Error(String(reason || 'Cancelled'));
            err.code = 'CANCELLED';
            reject(err);
        });
    });
    try {
        return await Promise.race([promise, cancelPromise]);
    } finally {
        // Best-effort detach: keep memory bounded
        try {
            if (cancelReject && Array.isArray(cancelToken._listeners)) {
                cancelToken._listeners = cancelToken._listeners.filter(fn => fn !== cancelReject);
            }
        } catch (_) {}
    }
}

/**
 * セーブボタンのイベントハンドラーを設定
 */
function setupSaveButton() {
    const saveBtn = document.getElementById('save-all-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', function() {
            if (document.activeElement) document.activeElement.blur();

            // Configurationsデータを取得
            const systemConfigurations = localStorage.getItem('systemConfigurations');
            const parsedConfig = systemConfigurations ? JSON.parse(systemConfigurations) : null;
            
            // Reference Focal Length を取得
            const refFLInput = document.getElementById('reference-focal-length');
            const referenceFocalLength = refFLInput ? refFLInput.value : '';
            
            const allData = {
                source: window.tableSource ? window.tableSource.getData() : [],
                object: window.tableObject ? window.tableObject.getData() : [],
                opticalSystem: window.tableOpticalSystem ? window.tableOpticalSystem.getData() : [],
                meritFunction: window.meritFunctionEditor ? window.meritFunctionEditor.getData() : [],
                systemRequirements: window.systemRequirementsEditor ? window.systemRequirementsEditor.getData() : [],
                systemData: {
                    referenceFocalLength: referenceFocalLength
                },
                // Configurationsデータ（meritFunctionはグローバル）
                configurations: parsedConfig
            };

            // 現在Loadされているファイル名を取得
            const loadedFileName = localStorage.getItem('loadedFileName');
            let defaultName = 'optical_system_data';
            
            // 拡張子を除いたファイル名をデフォルトにする
            if (loadedFileName) {
                defaultName = loadedFileName.replace(/\.json$/i, '');
            }

            let filename = prompt("保存するファイル名を入力してください（拡張子 .json は自動で付きます）\n\n※ダウンロードフォルダに既存ファイルがある場合はブラウザが自動的に連番を付けます", defaultName);
            if (!filename) return;
            if (!filename.endsWith('.json')) filename += '.json';

            const blob = new Blob([JSON.stringify(allData, null, 2)], {type: "application/json"});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            
            // 保存したファイル名を記録
            localStorage.setItem('loadedFileName', filename);
            
            // ファイル名表示を更新
            const fileNameElement = document.getElementById('loaded-file-name');
            if (fileNameElement) {
                fileNameElement.textContent = filename;
                fileNameElement.style.color = '#1a4d8f';
            }
            
            console.log('✅ データが保存されました:', filename);
        });
    }
}

function setupSuggestOptimizeButtons() {

    function setupDesignIntentBlocksToolbar() {
        const addBtn = document.getElementById('design-intent-add-block-btn');
        const delBtn = document.getElementById('design-intent-delete-block-btn');
        const typeSel = document.getElementById('design-intent-add-block-type');

        if (addBtn) {
            addBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const type = String(typeSel?.value ?? 'Lens').trim();
                const after = __blockInspectorExpandedBlockId;
                const res = __blocks_addBlockToActiveConfig(type, after);
                if (!res || res.ok !== true) {
                    alert(`Failed to add block: ${res?.reason || 'unknown error'}`);
                    return;
                }
                __blockInspectorExpandedBlockId = String(res.blockId ?? '') || null;
                try { refreshBlockInspector(); } catch (_) {}
                try {
                    if (window.popup3DWindow && !window.popup3DWindow.closed) {
                        window.popup3DWindow.postMessage({ action: 'request-redraw' }, '*');
                    }
                } catch (_) {}
            });
        }

        if (delBtn) {
            delBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const bid = String(__blockInspectorExpandedBlockId ?? '').trim();
                if (!bid) {
                    alert('Select (expand) a block first to delete.');
                    return;
                }
                const ok = confirm(`Delete block ${bid}?`);
                if (!ok) return;
                const res = __blocks_deleteBlockFromActiveConfig(bid);
                if (!res || res.ok !== true) {
                    alert(`Failed to delete block: ${res?.reason || 'unknown error'}`);
                    return;
                }
                __blockInspectorExpandedBlockId = null;
                try { refreshBlockInspector(); } catch (_) {}
                try {
                    if (window.popup3DWindow && !window.popup3DWindow.closed) {
                        window.popup3DWindow.postMessage({ action: 'request-redraw' }, '*');
                    }
                } catch (_) {}
            });
        }
    }

    // IMPORTANT: this was previously defined but never invoked.
    // Without this call, the Design Intent (Blocks) Add/Delete buttons do nothing.
    setupDesignIntentBlocksToolbar();

    const suggestBtn = document.getElementById('suggest-design-intent-btn');
    if (suggestBtn) {
        suggestBtn.addEventListener('click', (e) => {
            try { e?.preventDefault?.(); } catch (_) {}
            try { e?.stopPropagation?.(); } catch (_) {}

            const bid = String(__blockInspectorExpandedBlockId ?? '').trim();
            if (!bid) {
                alert('Select (expand) a block first.');
                return;
            }

            const container = document.getElementById('block-inspector');
            if (!container) return;

            // Trigger the inline glass helper by simulating Enter on the nd input.
            /** @type {HTMLInputElement|null} */
            let ndInput = null;
            try {
                const all = Array.from(container.querySelectorAll('input[data-glass-helper="nd"]'));
                const preferredKey = (() => {
                    try { return __blockInspectorPreferredMaterialKeyByBlockId.get(bid) || ''; } catch (_) { return ''; }
                })();

                ndInput = (
                    (preferredKey ? all.find(el => String(el?.dataset?.blockId ?? '') === bid && String(el?.dataset?.materialKey ?? '') === preferredKey) : null)
                    || all.find(el => String(el?.dataset?.blockId ?? '') === bid)
                    || all[0]
                    || null
                );
            } catch (_) {
                ndInput = null;
            }

            if (!ndInput) {
                alert('No material ref index/abbe inputs found for this block.');
                return;
            }

            try { ndInput.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
            try { ndInput.focus(); } catch (_) {}
            try {
                ndInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            } catch (_) {}
        });
    }

    const optimizeBtn = document.getElementById('optimize-design-intent-btn');
    if (optimizeBtn) {
        optimizeBtn.addEventListener('click', async () => {
            const prevDisabled = optimizeBtn.disabled;
            optimizeBtn.disabled = true;
            try {
                const opt = window.OptimizationMVP;
                if (!opt || typeof opt.run !== 'function') {
                    alert('OptimizationMVP が利用できません。');
                    return;
                }

                // Auto-detect scenarios: if 2+ scenarios exist, evaluate weighted sum.
                let multiScenario = false;
                try {
                    const systemConfig = (typeof loadSystemConfigurationsFromTableConfig === 'function')
                        ? loadSystemConfigurationsFromTableConfig()
                        : JSON.parse(localStorage.getItem('systemConfigurations'));
                    const activeId = systemConfig?.activeConfigId;
                    const activeCfg = systemConfig?.configurations?.find(c => c && c.id === activeId)
                        || systemConfig?.configurations?.[0];
                    if (activeCfg && Array.isArray(activeCfg.scenarios) && activeCfg.scenarios.length >= 2) {
                        multiScenario = true;
                    }
                } catch (_) {}

                // Progress popup window
                let popup = null;
                const stopFlag = { stop: false };
                let popupWatchTimer = null;
                                let isRunning = false;
                try {
                    popup = window.open('', 'coopt-optimizer-progress', 'width=500,height=550,resizable=yes,scrollbars=no');
                    if (popup && popup.document) {
                        popup.document.title = 'Optimize Progress';
                        popup.document.body.style.fontFamily = 'system-ui, -apple-system, Segoe UI, sans-serif';
                        popup.document.body.style.margin = '12px';
                        popup.document.body.innerHTML = `
<div style="font-size:14px; font-weight:600; margin-bottom:8px;">Optimize Progress</div>
<div style="font-size:12px; color:#555; margin-bottom:10px;">候補評価（±step）ごとに更新</div>
<div style="margin-bottom:10px; display:flex; align-items:center; gap:6px;">
    <button id="opt-run" style="padding:6px 10px;" disabled>Run</button>
    <button id="opt-stop" style="padding:6px 10px;">Stop</button>
    <span id="opt-stop-state" style="margin-left:8px; font-size:12px; color:#555;"></span>
</div>
<div style="margin-bottom:10px; display:flex; align-items:center; gap:10px;">
    <label style="font-size:12px; color:#555; display:flex; align-items:center; gap:6px;">
        Max Iterations
        <input id="opt-max-iter" type="number" min="1" step="1" value="1000" style="width:100px; padding:4px 6px;" />
    </label>
</div>
<div style="display:flex; gap:10px; flex-direction:column;">
    <div style="display:flex; align-items:baseline;"><span style="display:inline-block; width:110px; color:#555;">Phase</span><span id="opt-phase" style="margin-left:8px;">-</span></div>
    <div style="display:flex; align-items:baseline;"><span style="display:inline-block; width:110px; color:#555;">Decision</span><span id="opt-decision" style="margin-left:8px;">-</span></div>
    <div style="display:flex; align-items:baseline;"><span style="display:inline-block; width:110px; color:#555;">Accept/Reject</span><span id="opt-decision-count" style="margin-left:8px;">0 / 0</span></div>
    <div style="display:flex; align-items:baseline;"><span style="display:inline-block; width:110px; color:#555;">Iter</span><span id="opt-iter" style="margin-left:8px;">0</span></div>
    <div style="display:flex; align-items:baseline;"><span style="display:inline-block; width:110px; color:#555;">Req</span><span id="opt-req" style="margin-left:8px;">-</span></div>
    <div style="display:flex; align-items:baseline;"><span style="display:inline-block; width:110px; color:#555;">Res</span><span id="opt-res" style="margin-left:8px;">-</span></div>
    <div style="display:flex; align-items:baseline;"><span style="display:inline-block; width:110px; color:#555;">Score</span><span id="opt-cur" style="margin-left:8px;">-</span></div>
    <div style="display:flex; align-items:baseline;"><span style="display:inline-block; width:110px; color:#555;">Violation</span><span id="opt-vio" style="margin-left:8px;">-</span></div>
    <div style="display:flex; align-items:baseline;"><span style="display:inline-block; width:110px; color:#555;">Soft</span><span id="opt-soft" style="margin-left:8px;">-</span></div>
    <div style="display:flex; align-items:baseline;"><span style="display:inline-block; width:110px; color:#555;">Best</span><span id="opt-best" style="margin-left:8px;">-</span></div>
    <div style="display:flex; align-items:baseline;"><span style="display:inline-block; width:110px; color:#555;">Rho</span><span id="opt-rho" style="margin-left:8px;">-</span></div>
    <div style="display:flex; align-items:baseline;"><span style="display:inline-block; width:110px; color:#555;">Var</span><span id="opt-var" style="margin-left:8px;">-</span></div>
    <div style="display:flex; align-items:baseline;"><span style="display:inline-block; width:110px; color:#555;">Cand</span><span id="opt-cand" style="margin-left:8px;">-</span></div>
    <div style="display:flex; align-items:baseline;"><span style="display:inline-block; width:110px; color:#555;">Effective</span><span id="opt-effective" style="margin-left:8px;">-</span></div>
    <div style="display:flex; align-items:baseline;"><span style="display:inline-block; width:110px; color:#555;">Issue</span><span id="opt-issue" style="margin-left:8px;">-</span></div>
</div>
`;

                        try {
                            const stopBtn = popup.document.getElementById('opt-stop');
                            const runBtn = popup.document.getElementById('opt-run');
                            const stopState = popup.document.getElementById('opt-stop-state');
                            if (stopBtn) {
                                stopBtn.addEventListener('click', () => {
                                    stopFlag.stop = true;
                                    try {
                                        const opt = window.OptimizationMVP;
                                        if (opt && typeof opt.stop === 'function') opt.stop();
                                    } catch (_) {}
                                    try { stopBtn.disabled = true; } catch (_) {}
                                    try { if (runBtn) runBtn.disabled = true; } catch (_) {}
                                    if (stopState) stopState.textContent = 'Stopping...';
                                });
                            }

                            // Wire Run in the popup; the actual start function is attached below.
                            if (runBtn) {
                                runBtn.addEventListener('click', () => {
                                    try {
                                        const fn = window.__cooptStartOptimizationFromPopup;
                                        if (typeof fn === 'function') fn();
                                    } catch (_) {}
                                });
                            }
                        } catch (_) {}
                    }
                } catch (_) {
                    popup = null;
                }

                // Popup watchdog: only used to stop updating UI when the window is gone.
                // Do NOT auto-stop the optimizer just because the popup closed.
                if (popup) {
                    try {
                        popupWatchTimer = window.setInterval(() => {
                            if (!popup || popup.closed) {
                                if (popupWatchTimer) {
                                    try { window.clearInterval(popupWatchTimer); } catch (_) {}
                                    popupWatchTimer = null;
                                }
                            }
                        }, 250);
                    } catch (_) {
                        // ignore
                    }
                }

                const totalMeritEl = document.getElementById('total-merit-value');
                let lastVarText = '-';
                let lastCandText = '-';
                let lastEffText = '-';
                let lastIssueText = '-';
                let lastReqText = '-';
                let lastResText = '-';
                let lastRhoText = '-';
                let lastVioText = '-';
                let lastSoftText = '-';
                let lastDecisionText = '-';
                let acceptCount = 0;
                let rejectCount = 0;
                let __lastReqRefreshAt = 0;
                const __reqRefreshThrottleMs = 500;
                const updateProgressUI = (p) => {
                    // If popup was closed, just stop UI updates (optimizer can continue).

                    // If the optimizer has actually stopped, allow a new Optimize run immediately.
                    // (Cleanup/UI sync may still be finishing, but the heavy loop is done.)
                    const phaseStr = String(p?.phase ?? '');
                    if (phaseStr === 'stopped' || phaseStr === 'done' || phaseStr === 'error') {
                        try { optimizeBtn.disabled = false; } catch (_) {}
                        isRunning = false;
                    }

                    // Sticky accept/reject decision: Phase can change too quickly to notice.
                    if (phaseStr === 'accept') {
                        acceptCount++;
                        const a = (p && ('alpha' in p)) ? Number(p.alpha) : NaN;
                        const r = (p && ('rho' in p)) ? Number(p.rho) : NaN;
                        const aText = Number.isFinite(a) ? a.toFixed(6) : '-';
                        const rText = Number.isFinite(r) ? r.toFixed(6) : '-';
                        lastDecisionText = `ACCEPT (α=${aText}, ρ=${rText})`;
                    } else if (phaseStr === 'reject') {
                        rejectCount++;
                        lastDecisionText = 'REJECT';
                    }

                    const cur = Number(p?.current);
                    const best = Number(p?.best);
                    if (totalMeritEl && Number.isFinite(cur)) {
                        totalMeritEl.textContent = cur.toFixed(6);
                    }

                    // Optimizer evaluates operands directly, so the Requirements table can become stale.
                    // Refresh it at a low rate so UI reflects the same (fast-mode) state driving the score.
                    try {
                        const now = Date.now();
                        if ((now - __lastReqRefreshAt) >= __reqRefreshThrottleMs) {
                            if (phaseStr === 'start' || phaseStr === 'iter' || phaseStr === 'candidate' || phaseStr === 'accept' || phaseStr === 'reject') {
                                const sre = window.systemRequirementsEditor;
                                if (sre && typeof sre.scheduleEvaluateAndUpdate === 'function') {
                                    __lastReqRefreshAt = now;
                                    sre.scheduleEvaluateAndUpdate();
                                }
                            }
                        }
                    } catch (_) {}

                    // Preserve the last Var/Cand shown. LM progress updates often don't include
                    // variableId/candidateValue, and we don't want those updates to erase the fields.
                    if (p?.variableId) {
                        const prevVarText = lastVarText;
                        lastVarText = String(p.variableId);
                        if (lastVarText !== prevVarText) {
                            // Avoid showing stale values when switching to a new variable.
                            lastCandText = '-';
                            lastEffText = '-';
                            lastIssueText = '-';
                        }
                    }
                    if (p?.candidateValue !== undefined) {
                        lastCandText = String(p.candidateValue);
                    } else if (p?.acceptedValue !== undefined) {
                        lastCandText = String(p.acceptedValue);
                    }

                    // New fields added by optimizer-mvp.js to align displayed values with Design Intent/Requirements.
                    // Keep them "sticky" across LM progress events that omit variable/candidate/value fields.
                    if (p && ('effectiveValue' in p)) {
                        lastEffText = (p.effectiveValue === undefined || p.effectiveValue === null)
                            ? '-'
                            : String(p.effectiveValue);
                    } else if (p?.acceptedValue !== undefined && lastEffText === '-') {
                        // Best-effort fallback.
                        lastEffText = String(p.acceptedValue);
                    }
                    if (p && ('materialIssue' in p)) {
                        lastIssueText = (p.materialIssue === undefined || p.materialIssue === null || p.materialIssue === '')
                            ? '-'
                            : String(p.materialIssue);
                    }

                    // Surface the worst residual/requirement contributor (debug from optimizer-mvp.js).
                    // This is the most useful explanation for a large Score.
                    try {
                        const dbg = (window.__cooptLastOptimizerResidualDebug && typeof window.__cooptLastOptimizerResidualDebug === 'object')
                            ? window.__cooptLastOptimizerResidualDebug
                            : null;
                        const worst = dbg && dbg.worst && typeof dbg.worst === 'object' ? dbg.worst : null;
                        const at = dbg ? Number(dbg.at) : NaN;
                        const fresh = Number.isFinite(at) ? (Date.now() - at) < 3000 : false;
                        const fmtNum = (x) => {
                            const n = Number(x);
                            return Number.isFinite(n) ? n.toFixed(6) : String(x ?? '-');
                        };
                        if (fresh && worst && worst.operand) {
                            const op = String(worst.operand);
                            const cfg = String(worst.configId ?? '');
                            const sid = (worst.scenarioId !== undefined && worst.scenarioId !== null && String(worst.scenarioId).trim())
                                ? String(worst.scenarioId)
                                : '';
                            const amt = fmtNum(worst.amount);
                            const curV = fmtNum(worst.current);
                            const rsn = String(worst.reason ?? '').trim();

                            const spotTag = (() => {
                                try {
                                    if (!op.startsWith('SPOT_SIZE')) return '';
                                    const sd = (dbg && dbg.spotDebug && typeof dbg.spotDebug === 'object') ? dbg.spotDebug : null;
                                    if (!sd) return '';
                                    const impl = String(sd.impl ?? '').trim();
                                    const r = String(sd.reason ?? '').trim();
                                    const hrRaw = sd.earlyAbortHitRate;
                                    const hr = (hrRaw === null || hrRaw === undefined || hrRaw === '') ? NaN : Number(hrRaw);
                                    const kind = String(sd.failPenaltyKind ?? '').trim();
                                    const lf = (sd.lastRayTraceFailure && typeof sd.lastRayTraceFailure === 'object') ? sd.lastRayTraceFailure : null;
                                    const ld = (lf && lf.details && typeof lf.details === 'object') ? lf.details : null;
                                    const surfNo = Number(sd.blockSurfaceNumber ?? ld?.surfaceNumber);
                                    const hitR = Number(sd.blockHitRadiusMm ?? ld?.hitRadiusMm);
                                    const limR = Number(sd.blockApertureLimitMm ?? ld?.apertureLimitMm);
                                    const surfIdx = Number(sd.targetSurfaceIndex);
                                    const wl = Number(sd.wavelength);
                                    const rays = Number(sd.rayCountRequested);
                                    const hits = Number(sd.hits);
                                    const parts = [];
                                    if (impl) parts.push(impl);
                                    if (r) parts.push(r);
                                    if (Number.isFinite(hr)) parts.push(`hitRate=${hr.toFixed(3)}`);
                                    if (kind) parts.push(kind);
                                    if (Number.isFinite(surfIdx) && surfIdx >= 0) parts.push(`Sidx=${Math.floor(surfIdx)}`);
                                    if (Number.isFinite(wl) && wl > 0) parts.push(`wl=${wl.toFixed(4)}um`);
                                    if (Number.isFinite(rays) && rays > 0) parts.push(`rays=${Math.floor(rays)}`);
                                    if (Number.isFinite(hits) && hits >= 0) parts.push(`hits=${Math.floor(hits)}`);
                                    if (kind === 'PHYSICAL_APERTURE_BLOCK') {
                                        if (Number.isFinite(surfNo) && surfNo > 0) parts.push(`S${Math.floor(surfNo)}`);
                                        if (Number.isFinite(hitR) && Number.isFinite(limR) && limR > 0) {
                                            parts.push(`r=${hitR.toFixed(3)}/${limR.toFixed(3)}mm`);
                                        }
                                    }
                                    return parts.length > 0 ? ` [spot:${parts.join(' ')}]` : '';
                                } catch (_) {
                                    return '';
                                }
                            })();

                            const tag = sid ? ` cfg=${cfg} scn=${sid}` : (cfg ? ` cfg=${cfg}` : '');
                            const reasonTag = rsn ? ` (${rsn})` : '';

                            // Keep it single-line and compact.
                            lastIssueText = `Worst: ${op}${tag} cur=${curV} amt=${amt}${reasonTag}${spotTag}`;
                        }
                    } catch (_) {}

                    if (p?.requirementCount !== undefined) {
                        lastReqText = String(p.requirementCount);
                    }
                    if (p?.residualCount !== undefined) {
                        lastResText = String(p.residualCount);
                    }

                    // LM gain ratio (rho): keep sticky so non-candidate phases don't clear it.
                    if (p && ('rho' in p)) {
                        const r = Number(p.rho);
                        lastRhoText = Number.isFinite(r) ? r.toFixed(6) : '-';
                    }

                    // Score breakdown: sticky so intermediate LM phases don't erase it.
                    if (p && ('violationScore' in p)) {
                        const v = Number(p.violationScore);
                        lastVioText = Number.isFinite(v) ? v.toFixed(6) : '-';
                    }
                    if (p && ('softPenalty' in p)) {
                        const s = Number(p.softPenalty);
                        lastSoftText = Number.isFinite(s) ? s.toFixed(6) : '-';
                    }

                    if (popup && !popup.closed) {
                        try {
                            const doc = popup.document;
                            const setText = (id, v) => {
                                const el = doc.getElementById(id);
                                if (el) el.textContent = v;
                            };
                            setText('opt-phase', String(p?.phase ?? '-'));
                            setText('opt-decision', lastDecisionText);
                            setText('opt-decision-count', `${acceptCount} / ${rejectCount}`);
                            setText('opt-iter', String(p?.iter ?? '-'));
                            setText('opt-req', lastReqText);
                            setText('opt-res', lastResText);
                            setText('opt-cur', Number.isFinite(cur) ? cur.toFixed(6) : String(p?.current ?? '-'));
                            setText('opt-vio', lastVioText);
                            setText('opt-soft', lastSoftText);
                            setText('opt-best', Number.isFinite(best) ? best.toFixed(6) : String(p?.best ?? '-'));
                            setText('opt-rho', lastRhoText);
                            setText('opt-var', lastVarText);
                            setText('opt-cand', lastCandText);
                            setText('opt-effective', lastEffText);
                            setText('opt-issue', lastIssueText);

                            // Stop state rendering
                            if (String(p?.phase) === 'stopped') {
                                setText('opt-stop-state', 'Stopped');
                                try {
                                    const btn = doc.getElementById('opt-stop');
                                    if (btn) btn.disabled = true;
                                    const runBtn = doc.getElementById('opt-run');
                                    if (runBtn) runBtn.disabled = false;
                                } catch (_) {}
                            } else if (String(p?.phase) === 'done') {
                                setText('opt-stop-state', 'Done');
                                try {
                                    const btn = doc.getElementById('opt-stop');
                                    if (btn) btn.disabled = true;
                                    const runBtn = doc.getElementById('opt-run');
                                    if (runBtn) runBtn.disabled = false;
                                } catch (_) {}
                            } else if (String(p?.phase) === 'error') {
                                setText('opt-stop-state', 'Error');
                                try {
                                    const btn = doc.getElementById('opt-stop');
                                    if (btn) btn.disabled = true;
                                    const runBtn = doc.getElementById('opt-run');
                                    if (runBtn) runBtn.disabled = false;
                                } catch (_) {}
                            } else if (stopFlag.stop) {
                                setText('opt-stop-state', 'Stopping...');
                            }
                        } catch (_) {}
                    }
                };

                const startRun = async () => {
                    if (isRunning) return;
                    isRunning = true;

                    stopFlag.stop = false;
                    acceptCount = 0;
                    rejectCount = 0;
                    lastVarText = '-';
                    lastCandText = '-';
                    lastEffText = '-';
                    lastIssueText = '-';
                    lastReqText = '-';
                    lastResText = '-';
                    lastRhoText = '-';
                    lastVioText = '-';
                    lastSoftText = '-';
                    lastDecisionText = '-';

                    try {
                        // Sync popup button states
                        if (popup && !popup.closed) {
                            const doc = popup.document;
                            const stopBtn = doc.getElementById('opt-stop');
                            const runBtn = doc.getElementById('opt-run');
                            const stopState = doc.getElementById('opt-stop-state');
                            if (stopBtn) stopBtn.disabled = false;
                            if (runBtn) runBtn.disabled = true;
                            if (stopState) stopState.textContent = 'Running...';
                        }
                    } catch (_) {}

                    try { optimizeBtn.disabled = true; } catch (_) {}

                    console.log('🛠️ [Optimize] Running OptimizationMVP...', { multiScenario });
                    const shouldStopNow = () => {
                        return !!stopFlag.stop;
                    };

                    const resolveMaxIterations = () => {
                        let n = 1000;
                        try {
                            if (popup && !popup.closed) {
                                const el = popup.document.getElementById('opt-max-iter');
                                const v = el ? Number(el.value) : NaN;
                                if (Number.isFinite(v)) n = Math.trunc(v);
                            }
                        } catch (_) {}
                        if (!Number.isFinite(n) || n < 1) n = 1000;
                        return n;
                    };

                    const maxIterations = resolveMaxIterations();

                    let result = null;
                    try {
                        // Force-disable ray-tracing detailed debug logs during optimization.
                        // This prevents WASM intersection fast-path from being bypassed.
                        let __prevDisableRayTraceDebug;
                        let __prevOptimizerIsRunning;
                        try {
                            __prevDisableRayTraceDebug = (typeof globalThis !== 'undefined') ? globalThis.__COOPT_DISABLE_RAYTRACE_DEBUG : undefined;
                        } catch (_) { __prevDisableRayTraceDebug = undefined; }
                        try {
                            __prevOptimizerIsRunning = (typeof globalThis !== 'undefined') ? globalThis.__cooptOptimizerIsRunning : undefined;
                        } catch (_) { __prevOptimizerIsRunning = undefined; }
                        try {
                            if (typeof globalThis !== 'undefined') {
                                globalThis.__COOPT_DISABLE_RAYTRACE_DEBUG = true;
                                globalThis.__cooptOptimizerIsRunning = true;
                            }
                        } catch (_) {}

                        result = await opt.run({
                            multiScenario,
                            // Run a bounded number of iterations by default so
                            // the optimizer does not depend on the popup staying open.
                            runUntilStopped: false,
                            maxIterations,
                            method: 'lm',
                            stageMaxCoef: [10], // unlock all asphere coef at once
                            onProgress: updateProgressUI,
                            shouldStop: shouldStopNow
                        });
                        console.log('✅ [Optimize] Done', result);

                        // Restore flags after successful completion.
                        try {
                            if (typeof globalThis !== 'undefined') {
                                if (__prevDisableRayTraceDebug !== undefined) globalThis.__COOPT_DISABLE_RAYTRACE_DEBUG = __prevDisableRayTraceDebug;
                                else {
                                    try { delete globalThis.__COOPT_DISABLE_RAYTRACE_DEBUG; } catch (_) {}
                                }
                                if (__prevOptimizerIsRunning !== undefined) globalThis.__cooptOptimizerIsRunning = __prevOptimizerIsRunning;
                                else {
                                    try { delete globalThis.__cooptOptimizerIsRunning; } catch (_) {}
                                }
                            }
                        } catch (_) {}
                    } catch (e) {
                        console.warn('⚠️ [Optimize] Failed:', e);
                        result = { ok: false, reason: e?.message ?? String(e) };

                        // Restore flags on error too.
                        try {
                            if (typeof globalThis !== 'undefined') {
                                if (__prevDisableRayTraceDebug !== undefined) globalThis.__COOPT_DISABLE_RAYTRACE_DEBUG = __prevDisableRayTraceDebug;
                                else {
                                    try { delete globalThis.__COOPT_DISABLE_RAYTRACE_DEBUG; } catch (_) {}
                                }
                                if (__prevOptimizerIsRunning !== undefined) globalThis.__cooptOptimizerIsRunning = __prevOptimizerIsRunning;
                                else {
                                    try { delete globalThis.__cooptOptimizerIsRunning; } catch (_) {}
                                }
                            }
                        } catch (_) {}
                    }

                    // Ensure UI is consistent after the run.
                    isRunning = false;
                    try { optimizeBtn.disabled = false; } catch (_) {}
                    try {
                        if (popup && !popup.closed) {
                            const doc = popup.document;
                            const stopBtn = doc.getElementById('opt-stop');
                            const runBtn = doc.getElementById('opt-run');
                            const stopState = doc.getElementById('opt-stop-state');
                            if (stopBtn) stopBtn.disabled = true;
                            if (runBtn) runBtn.disabled = false;
                            if (stopState && stopFlag.stop) stopState.textContent = 'Stopped';
                        }
                    } catch (_) {}

                    if (result && result.ok === false) {
                        const reason = String(result.reason || 'Optimize did not run.');
                        try {
                            if (popup && !popup.closed) {
                                const el = popup.document.getElementById('opt-phase');
                                if (el) el.textContent = 'error';
                                const cur = popup.document.getElementById('opt-cur');
                                if (cur) cur.textContent = reason;
                            }
                        } catch (_) {}
                        alert(reason);
                    }
                };

                // Expose the starter in a predictable place for the popup.
                // (Popup event handler can't close over this function directly across reloads.)
                try {
                    window.__cooptStartOptimizationFromPopup = startRun;
                } catch (_) {}

                // Initial run
                await startRun();

            } catch (e) {
                console.warn('⚠️ [Optimize] Failed:', e);
                alert('Optimize の実行に失敗しました。console を確認してください。');
            } finally {
                try {
                    optimizeBtn.disabled = false;
                } catch (_) {}
            }
        });
    }
}

/**
 * ロードボタンのイベントハンドラーを設定
 */
function setupLoadButton() {
    const loadBtn = document.getElementById('load-all-btn');
    if (loadBtn) {
        loadBtn.addEventListener('click', function() {
            console.log('🔵 [Load] Load button clicked');
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            
            // DOMに一時的に追加（非表示）
            input.style.display = 'none';
            document.body.appendChild(input);
            console.log('🔵 [Load] Input element created and added to DOM');
            
            input.onchange = e => {
                const file = e.target.files[0];
                console.log('🔵 [Load] File selected:', file ? file.name : 'none');
                if (!file) {
                    // クリーンアップ
                    document.body.removeChild(input);
                    return;
                }
                const reader = new FileReader();
                reader.onload = evt => {
                    console.log('🔵 [Load] File read complete, parsing JSON...');
                    let allData;
                    try {
                        allData = JSON.parse(evt.target.result);
                    } catch (err) {
                        showLoadErrors([
                            { severity: 'fatal', phase: 'parse', message: `JSON parse error: ${err?.message || String(err)}` }
                        ], { filename: file.name });
                        document.body.removeChild(input);
                        return;
                    }

                    console.log('🔵 [Load] JSON parsed successfully');
                    // New load attempt: clear any previous warning marker; warnings will re-set it.
                    setLoadWarnUIFlag(false);

                    // Normalize phase: accept multiple input shapes but continue with a single canonical shape.
                    try {
                        const normalizedResult = normalizeDesign(allData);
                        if (!showLoadErrors(normalizedResult.issues, { filename: file.name })) {
                            document.body.removeChild(input);
                            return;
                        }
                        allData = normalizedResult.normalized;
                    } catch (err) {
                        showLoadErrors([
                            { severity: 'fatal', phase: 'normalize', message: `Unexpected normalize error: ${err?.message || String(err)}` }
                        ], { filename: file.name });
                        document.body.removeChild(input);
                        return;
                    }
                    console.log('🔵 [Load] Data structure:', {
                        hasSource: !!allData.source,
                        hasObject: !!allData.object,
                        hasOpticalSystem: !!allData.opticalSystem,
                        hasMeritFunction: !!allData.meritFunction,
                        hasConfigurations: !!allData.configurations
                    });

                    // 保存前のストレージ状態を確認
                    console.log('🔵 [Load] localStorage before save:', {
                        sourceExists: !!localStorage.getItem('sourceTableData'),
                        objectExists: !!localStorage.getItem('objectTableData'),
                        opticalSystemExists: !!localStorage.getItem('OpticalSystemTableData')
                    });

                    // Build candidate configuration object but do NOT save yet.
                    /** @type {any} */
                    let candidateConfig;
                    if (allData && allData.configurations) {
                        candidateConfig = allData.configurations;
                    } else {
                        showLoadErrors([
                            { severity: 'fatal', phase: 'normalize', message: 'Normalization did not produce configurations wrapper.' }
                        ], { filename: file.name });
                        document.body.removeChild(input);
                        return;
                    }

                    // Validate phase (block schema)
                    /** @type {Array<any>} */
                    const issues = [];

                    const cfgList = Array.isArray(candidateConfig?.configurations) ? candidateConfig.configurations : [];

                    const countBlocksByType = (blocks) => {
                        const out = { Lens: 0, Doublet: 0, Triplet: 0, AirGap: 0, Stop: 0, ImagePlane: 0, Other: 0 };
                        if (!Array.isArray(blocks)) return out;
                        for (const b of blocks) {
                            const t = String(b?.blockType ?? '');
                            if (Object.prototype.hasOwnProperty.call(out, t)) out[t]++;
                            else out.Other++;
                        }
                        return out;
                    };

                    const blocksLookSuspicious = (cfg) => {
                        try {
                            const blocks = cfg?.blocks;
                            if (!Array.isArray(blocks) || blocks.length === 0) return false;
                            const isNumericish = (v) => {
                                if (typeof v === 'number') return Number.isFinite(v);
                                const s = String(v ?? '').trim();
                                if (!s) return false;
                                return /^[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?$/i.test(s);
                            };
                            for (const b of blocks) {
                                const type = String(b?.blockType ?? '');
                                if (type === 'Lens') {
                                    const mat = b?.parameters?.material;
                                    // A lens material should be a glass name, not a refractive index number.
                                    if (isNumericish(mat)) return true;
                                }
                                if (type === 'Doublet' || type === 'Triplet') {
                                    const m1 = b?.parameters?.material1;
                                    const m2 = b?.parameters?.material2;
                                    const m3 = b?.parameters?.material3;
                                    if (isNumericish(m1) || isNumericish(m2) || isNumericish(m3)) return true;
                                }
                            }
                            return false;
                        } catch (_) {
                            return false;
                        }
                    };

                    // If blocks are missing, or embedded blocks look inconsistent, try to auto-derive Blocks.
                    // This enables Apply-to-Design-Intent even for cemented lenses (Doublet/Triplet).
                    for (const cfg of cfgList) {
                        try {
                            const legacyRows = Array.isArray(cfg?.opticalSystem) ? cfg.opticalSystem : null;
                            if (!legacyRows || legacyRows.length === 0) continue;

                            const hasBlocks = configurationHasBlocks(cfg);
                            const suspicious = hasBlocks && blocksLookSuspicious(cfg);
                            const existingCounts = hasBlocks ? countBlocksByType(cfg.blocks) : null;

                            // Always do a best-effort derive for comparison.
                            const derived = deriveBlocksFromLegacyOpticalSystemRows(legacyRows);
                            const hasFatal = Array.isArray(derived?.issues) && derived.issues.some(i => i && i.severity === 'fatal');
                            if (hasFatal) {
                                if (!hasBlocks) {
                                    // Do not fail the Load; keep legacy surface workflow.
                                    const converted = (derived.issues || []).map(i => ({
                                        ...i,
                                        severity: 'warning',
                                        message: `Blocks conversion skipped: ${i?.message || String(i)}`
                                    }));
                                    issues.push(...converted);
                                    if (!cfg.metadata || typeof cfg.metadata !== 'object') cfg.metadata = {};
                                    cfg.metadata.importAnalyzeMode = true;
                                }
                                continue;
                            }

                            const derivedCounts = countBlocksByType(derived?.blocks);
                            const wouldIncreaseDoublets = !!existingCounts && (derivedCounts.Doublet > existingCounts.Doublet);

                            // Decide whether to set/replace blocks:
                            // - if blocks missing: set
                            // - if suspicious: replace
                            // - if derived yields more Doublets: replace (user expectation: cemented groups preserved)
                            if (!hasBlocks || suspicious || wouldIncreaseDoublets) {
                                cfg.schemaVersion = cfg.schemaVersion || BLOCK_SCHEMA_VERSION;
                                cfg.blocks = Array.isArray(derived?.blocks) ? derived.blocks : [];
                                if (!cfg.metadata || typeof cfg.metadata !== 'object') cfg.metadata = {};
                                cfg.metadata.importAnalyzeMode = false;
                                if (suspicious) cfg.metadata.importBlocksRepaired = true;
                                if (wouldIncreaseDoublets) cfg.metadata.importBlocksRebuiltForCemented = true;

                                if (hasBlocks && (suspicious || wouldIncreaseDoublets)) {
                                    issues.push({
                                        severity: 'warning',
                                        phase: 'validate',
                                        message: `Blocks were rebuilt from opticalSystem to better preserve cemented groups (Doublet/Triplet) during Design Intent load.`
                                    });
                                }

                                // Carry over non-fatal conversion warnings.
                                if (Array.isArray(derived?.issues) && derived.issues.length > 0) {
                                    issues.push(...derived.issues);
                                }
                            } else {
                                // Keep existing blocks; still report non-fatal derive issues if any.
                                if (Array.isArray(derived?.issues) && derived.issues.length > 0) {
                                    const converted = (derived.issues || []).map(i => ({
                                        ...i,
                                        severity: 'warning',
                                        message: `Blocks check (kept embedded blocks): ${i?.message || String(i)}`
                                    }));
                                    issues.push(...converted);
                                }
                            }
                        } catch (e) {
                            issues.push({ severity: 'warning', phase: 'validate', message: `Blocks conversion failed unexpectedly: ${e?.message || String(e)}` });
                        }
                    }

                    for (const cfg of cfgList) {
                        if (configurationHasBlocks(cfg)) {
                            issues.push(...validateBlocksConfiguration(cfg));
                        }
                    }

                    if (!showLoadErrors(issues, { filename: file.name })) {
                        document.body.removeChild(input);
                        return;
                    }

                    // Expand phase (only active config needs derived opticalSystem right now)
                    try {
                        const activeId = candidateConfig?.activeConfigId || 1;
                        const activeCfg = cfgList.find(c => c.id === activeId) || cfgList[0];
                        if (activeCfg && configurationHasBlocks(activeCfg)) {
                            const legacyBeforeExpand = Array.isArray(activeCfg.opticalSystem) ? activeCfg.opticalSystem : null;
                            // validate already ran above; avoid re-validating here to prevent duplicate warnings.
                            const expanded = expandBlocksToOpticalSystemRows(activeCfg.blocks);
                            issues.push(...expanded.issues);
                            if (!showLoadErrors(expanded.issues, { filename: file.name })) {
                                document.body.removeChild(input);
                                return;
                            }
                            // IMPORTANT: keep legacy surface rows as-is (preserve per-surface fields like semidia),
                            // and only overlay provenance so Apply-to-Design-Intent can reverse-map edits.
                            if (Array.isArray(legacyBeforeExpand) && legacyBeforeExpand.length > 0) {
                                try { __blocks_overlayExpandedProvenanceIntoLegacyRows(legacyBeforeExpand, expanded.rows); } catch (_) {}
                                // Preserve object row thickness/semidia even if indices don't align.
                                try { __blocks_mergeLegacyIndexFieldsIntoExpandedRows(legacyBeforeExpand, legacyBeforeExpand); } catch (_) {}
                                // Normalize ids to current indices (Tabulator expects numeric ids).
                                try {
                                    for (let ii = 0; ii < legacyBeforeExpand.length; ii++) {
                                        if (legacyBeforeExpand[ii] && typeof legacyBeforeExpand[ii] === 'object') legacyBeforeExpand[ii].id = ii;
                                    }
                                } catch (_) {}
                                activeCfg.opticalSystem = legacyBeforeExpand;
                            } else {
                                activeCfg.opticalSystem = expanded.rows;
                            }
                        }
                    } catch (err) {
                        if (!showLoadErrors([
                            { severity: 'fatal', phase: 'expand', message: `Unexpected expand error: ${err?.message || String(err)}` }
                        ], { filename: file.name })) {
                            document.body.removeChild(input);
                            return;
                        }
                    }

                    // Determine the effective payload to load into the tables.
                    // Prefer top-level fields; fall back to active config in candidateConfig.
                    let effectiveSource = allData.source;
                    let effectiveObject = allData.object;
                    let effectiveOpticalSystem = allData.opticalSystem;
                    let effectiveMeritFunction = allData.meritFunction;
                    let effectiveSystemRequirements = allData.systemRequirements;
                    let effectiveSystemData = allData.systemData;

                    // If blocks exist, the expanded active configuration is the source of truth.
                    // Do NOT allow top-level legacy opticalSystem to override derived rows.
                    try {
                        const activeId = candidateConfig?.activeConfigId || 1;
                        const activeCfg = cfgList.find(c => c.id === activeId) || cfgList[0];
                        if (activeCfg && configurationHasBlocks(activeCfg) && Array.isArray(activeCfg.opticalSystem)) {
                            effectiveOpticalSystem = activeCfg.opticalSystem;
                        }
                    } catch (_) {}

                    if (!effectiveSource || !effectiveObject || !effectiveOpticalSystem || !effectiveSystemData) {
                        try {
                            const activeId = candidateConfig?.activeConfigId || 1;
                            const activeCfg = cfgList.find(c => c.id === activeId) || cfgList[0];

                            if (activeCfg) {
                                if (!effectiveSource && activeCfg.source) effectiveSource = activeCfg.source;
                                if (!effectiveObject && activeCfg.object) effectiveObject = activeCfg.object;
                                if (!effectiveOpticalSystem && activeCfg.opticalSystem) effectiveOpticalSystem = activeCfg.opticalSystem;
                                if (!effectiveSystemData && activeCfg.systemData) effectiveSystemData = activeCfg.systemData;
                            }

                            if (!effectiveMeritFunction && candidateConfig?.meritFunction) effectiveMeritFunction = candidateConfig.meritFunction;
                            if (!effectiveSystemRequirements && candidateConfig?.systemRequirements) effectiveSystemRequirements = candidateConfig.systemRequirements;
                        } catch (e) {
                            console.warn('⚠️ [Load] Failed to derive table data from configurations:', e);
                        }
                    }

                    // At this point, validation/expansion succeeded: write to localStorage.
                    try {
                        localStorage.setItem('systemConfigurations', JSON.stringify(candidateConfig));
                        console.log('🔵 [Load] Configurations data saved');
                    } catch (e) {
                        showLoadErrors([
                            { severity: 'fatal', phase: 'validate', message: `Failed to persist configurations: ${e?.message || String(e)}` }
                        ], { filename: file.name });
                        document.body.removeChild(input);
                        return;
                    }

                    // System Data を復元（Reference Focal Length）
                    if (effectiveSystemData) {
                        const refFLInput = document.getElementById('reference-focal-length');
                        if (refFLInput) {
                            refFLInput.value = effectiveSystemData.referenceFocalLength || '';
                        }
                    }

                    saveSourceTableData(effectiveSource || []);
                    console.log('🔵 [Load] Source data saved');
                    saveObjectTableData(effectiveObject || []);
                    console.log('🔵 [Load] Object data saved');
                    saveLensTableData(effectiveOpticalSystem || []);
                    console.log('🔵 [Load] Optical system data saved');

                    if (effectiveMeritFunction) {
                        localStorage.setItem('meritFunctionData', JSON.stringify(effectiveMeritFunction));
                        console.log('🔵 [Load] Merit function data saved');
                    }

                    if (effectiveSystemRequirements) {
                        localStorage.setItem('systemRequirementsData', JSON.stringify(effectiveSystemRequirements));
                        console.log('🔵 [Load] System requirements data saved');
                    }

                    // ファイル名を保存
                    localStorage.setItem('loadedFileName', file.name);
                    console.log('🔵 [Load] File name saved:', file.name);

                    // 保存後のストレージ状態を確認
                    console.log('🔵 [Load] localStorage after save:', {
                        sourceExists: !!localStorage.getItem('sourceTableData'),
                        objectExists: !!localStorage.getItem('objectTableData'),
                        opticalSystemExists: !!localStorage.getItem('OpticalSystemTableData')
                    });

                    console.log('✅ データが読み込まれました:', file.name);
                    console.log('🔵 [Load] Applying to UI (no reload)...');

                    // Clean up file input early (we no longer reload).
                    document.body.removeChild(input);

                    // Update file name UI immediately.
                    try {
                        const fileNameElement = document.getElementById('loaded-file-name');
                        if (fileNameElement) {
                            fileNameElement.textContent = file.name;
                            fileNameElement.style.color = '#1a4d8f';
                        }
                    } catch (_) {}

                    // Push new data into existing Tabulator instances.
                    try { globalThis.__configurationAutoSaveDisabled = true; } catch (_) {}
                    try {
                        const tasks = [];
                        if (window.tableSource && typeof window.tableSource.setData === 'function') {
                            tasks.push(Promise.resolve(window.tableSource.setData(effectiveSource || [])));
                        }
                        if (window.tableObject && typeof window.tableObject.setData === 'function') {
                            tasks.push(Promise.resolve(window.tableObject.setData(effectiveObject || [])));
                        }
                        if (window.tableOpticalSystem && typeof window.tableOpticalSystem.setData === 'function') {
                            tasks.push(Promise.resolve(window.tableOpticalSystem.setData(effectiveOpticalSystem || [])));
                        }

                        if (window.systemRequirementsEditor && typeof window.systemRequirementsEditor.setData === 'function') {
                            tasks.push(Promise.resolve(window.systemRequirementsEditor.setData(effectiveSystemRequirements || [])));
                        }

                        Promise.allSettled(tasks).finally(() => {
                            try { globalThis.__configurationAutoSaveDisabled = false; } catch (_) {}
                            try { updateSurfaceNumberSelect(); } catch (_) {}
                            try { if (typeof window.refreshConfigurationUI === 'function') window.refreshConfigurationUI(); } catch (_) {}
                            try { if (typeof window.updatePSFObjectOptions === 'function') window.updatePSFObjectOptions(); } catch (_) {}
                            // Wavefront Object dropdown is derived from tableObject; refresh explicitly.
                            // (Tabulator setData does not always fire dataChanged.)
                            try { if (typeof window.updateWavefrontObjectSelect === 'function') window.updateWavefrontObjectSelect(); } catch (_) {}
                            try { refreshBlockInspector(); } catch (_) {}
                            // Auto redraw 3D popup after Load (no manual Render click)
                            try {
                                const popup = window.popup3DWindow;
                                if (popup && !popup.closed && typeof popup.postMessage === 'function') {
                                    popup.postMessage({ action: 'request-redraw' }, '*');
                                }
                            } catch (_) {}
                            console.log('✅ [Load] UI updated without reload');
                        });
                    } catch (e) {
                        try { globalThis.__configurationAutoSaveDisabled = false; } catch (_) {}
                        console.warn('⚠️ [Load] Failed to apply data to UI immediately:', e);
                    }
                };
                reader.onerror = () => {
                    console.error('❌ [Load] FileReader error:', reader.error);
                    showLoadErrors([
                        { severity: 'fatal', phase: 'parse', message: `FileReader error: ${reader.error?.message || String(reader.error)}` }
                    ], { filename: file.name });
                    // クリーンアップ
                    document.body.removeChild(input);
                };
                console.log('🔵 [Load] Starting file read...');
                reader.readAsText(file);
            };
            
            console.log('🔵 [Load] Triggering file dialog...');
            input.click();
        });
    }
}

/**
 * ストレージクリアボタンのイベントハンドラーを設定
 */
function setupClearStorageButton() {
    const clearStorageBtn = document.getElementById('clear-storage-btn');
    if (clearStorageBtn) {
        clearStorageBtn.addEventListener('click', async function() {
            const confirmed = confirm('すべての保存データを削除してもよろしいですか？この操作は元に戻せません。');
            if (confirmed) {
                try {
                    localStorage.removeItem('sourceTableData');
                    localStorage.removeItem('objectTableData');
                    localStorage.removeItem('OpticalSystemTableData');
                    localStorage.removeItem('opticalSystemTableData');
                    localStorage.removeItem('meritFunctionData');
                    localStorage.removeItem('systemRequirementsData');
                    localStorage.removeItem('loadedFileName'); // ファイル名もクリア
                    localStorage.removeItem('loadedFileWarn'); // load warning flag もクリア
                    localStorage.removeItem('systemConfigurations'); // Configurationsもクリア
                    localStorage.removeItem('systemData'); // System Dataもクリア

                    // After clearing, immediately bootstrap a default design (same behavior as Load).
                    // This keeps Design Intent editable without requiring manual file selection.
                    try {
                        // NOTE: keep this as a string literal so the GitHub Pages docs builder can include it.
                        const res = await fetch('defaults/default-load.json', { cache: 'no-store' });
                        if (!res.ok) throw new Error(`Failed to fetch default JSON: ${res.status} ${res.statusText}`);
                        const text = await res.text();
                        const parsed = JSON.parse(text);

                        // Reuse the Load pipeline (normalize -> validate/derive blocks -> expand active -> persist).
                        // We only persist to storage here; the page will reload afterwards.
                        let allData = parsed;
                        setLoadWarnUIFlag(false);
                        const normalizedResult = normalizeDesign(allData);
                        // If normalization emits fatal issues, fall back to empty state.
                        const fatalNorm = (normalizedResult.issues || []).some(i => i && i.severity === 'fatal');
                        if (!fatalNorm) {
                            allData = normalizedResult.normalized;
                            const candidateConfig = allData?.configurations;
                            const cfgList = Array.isArray(candidateConfig?.configurations) ? candidateConfig.configurations : [];

                            const issues = [];
                            const countBlocksByType = (blocks) => {
                                const out = { Lens: 0, Doublet: 0, Triplet: 0, Gap: 0, AirGap: 0, Stop: 0, ImagePlane: 0, Other: 0 };
                                if (!Array.isArray(blocks)) return out;
                                for (const b of blocks) {
                                    const t = String(b?.blockType ?? '');
                                    if (Object.prototype.hasOwnProperty.call(out, t)) out[t]++;
                                    else out.Other++;
                                }
                                return out;
                            };
                            const blocksLookSuspicious = (cfg) => {
                                try {
                                    const blocks = cfg?.blocks;
                                    if (!Array.isArray(blocks) || blocks.length === 0) return false;
                                    const isNumericish = (v) => {
                                        if (typeof v === 'number') return Number.isFinite(v);
                                        const s = String(v ?? '').trim();
                                        if (!s) return false;
                                        return /^[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?$/i.test(s);
                                    };
                                    for (const b of blocks) {
                                        const type = String(b?.blockType ?? '');
                                        if (type === 'Lens') {
                                            const mat = b?.parameters?.material;
                                            if (isNumericish(mat)) return true;
                                        }
                                        if (type === 'Doublet' || type === 'Triplet') {
                                            const m1 = b?.parameters?.material1;
                                            const m2 = b?.parameters?.material2;
                                            const m3 = b?.parameters?.material3;
                                            if (isNumericish(m1) || isNumericish(m2) || isNumericish(m3)) return true;
                                        }
                                    }
                                    return false;
                                } catch (_) {
                                    return false;
                                }
                            };

                            for (const cfg of cfgList) {
                                try {
                                    const legacyRows = Array.isArray(cfg?.opticalSystem) ? cfg.opticalSystem : null;
                                    if (!legacyRows || legacyRows.length === 0) continue;

                                    const hasBlocks = configurationHasBlocks(cfg);
                                    const suspicious = hasBlocks && blocksLookSuspicious(cfg);
                                    const existingCounts = hasBlocks ? countBlocksByType(cfg.blocks) : null;

                                    const derived = deriveBlocksFromLegacyOpticalSystemRows(legacyRows);
                                    const hasFatal = Array.isArray(derived?.issues) && derived.issues.some(i => i && i.severity === 'fatal');
                                    if (hasFatal) {
                                        if (!hasBlocks) {
                                            if (!cfg.metadata || typeof cfg.metadata !== 'object') cfg.metadata = {};
                                            cfg.metadata.importAnalyzeMode = true;
                                        }
                                        continue;
                                    }

                                    const derivedCounts = countBlocksByType(derived?.blocks);
                                    const wouldIncreaseDoublets = !!existingCounts && (derivedCounts.Doublet > existingCounts.Doublet);
                                    if (!hasBlocks || suspicious || wouldIncreaseDoublets) {
                                        cfg.schemaVersion = cfg.schemaVersion || BLOCK_SCHEMA_VERSION;
                                        cfg.blocks = Array.isArray(derived?.blocks) ? derived.blocks : [];
                                        if (!cfg.metadata || typeof cfg.metadata !== 'object') cfg.metadata = {};
                                        cfg.metadata.importAnalyzeMode = false;
                                    }
                                    if (Array.isArray(derived?.issues) && derived.issues.length > 0) {
                                        issues.push(...derived.issues);
                                    }
                                } catch (e) {
                                    issues.push({ severity: 'warning', phase: 'validate', message: `Blocks conversion failed unexpectedly: ${e?.message || String(e)}` });
                                }
                            }

                            for (const cfg of cfgList) {
                                if (configurationHasBlocks(cfg)) {
                                    issues.push(...validateBlocksConfiguration(cfg));
                                }
                            }

                            // Expand active config if it has blocks so OpticalSystemTableData is usable immediately.
                            try {
                                const activeId = candidateConfig?.activeConfigId || 1;
                                const activeCfg = cfgList.find(c => c.id === activeId) || cfgList[0];
                                if (activeCfg && configurationHasBlocks(activeCfg)) {
                                    const expanded = expandBlocksToOpticalSystemRows(activeCfg.blocks);
                                    issues.push(...expanded.issues);
                                    // Prefer keeping legacy opticalSystem rows if present; otherwise use expanded.
                                    if (!Array.isArray(activeCfg.opticalSystem) || activeCfg.opticalSystem.length === 0) {
                                        activeCfg.opticalSystem = expanded.rows;
                                    }
                                }
                            } catch (e) {
                                issues.push({ severity: 'warning', phase: 'expand', message: `Expand failed: ${e?.message || String(e)}` });
                            }

                            // Persist configurations wrapper.
                            localStorage.setItem('systemConfigurations', JSON.stringify(candidateConfig));

                            // Persist table data (match Load behavior as closely as possible).
                            const activeId = candidateConfig?.activeConfigId || 1;
                            const activeCfg = cfgList.find(c => c.id === activeId) || cfgList[0] || null;
                            const effectiveSource = allData.source ?? activeCfg?.source ?? [];
                            const effectiveObject = allData.object ?? activeCfg?.object ?? [];
                            const effectiveOpticalSystem = (activeCfg && configurationHasBlocks(activeCfg) && Array.isArray(activeCfg.opticalSystem))
                                ? activeCfg.opticalSystem
                                : (allData.opticalSystem ?? activeCfg?.opticalSystem ?? []);
                            const effectiveMeritFunction = allData.meritFunction ?? candidateConfig?.meritFunction ?? [];
                            const effectiveSystemRequirements = allData.systemRequirements ?? candidateConfig?.systemRequirements ?? [];
                            const effectiveSystemData = allData.systemData ?? activeCfg?.systemData ?? null;

                            saveSourceTableData(effectiveSource || []);
                            saveObjectTableData(effectiveObject || []);
                            saveLensTableData(effectiveOpticalSystem || []);
                            if (effectiveMeritFunction) localStorage.setItem('meritFunctionData', JSON.stringify(effectiveMeritFunction));
                            if (effectiveSystemRequirements) localStorage.setItem('systemRequirementsData', JSON.stringify(effectiveSystemRequirements));
                            if (effectiveSystemData) localStorage.setItem('systemData', JSON.stringify(effectiveSystemData));

                            // Keep consistent UX: show a loaded file name.
                            localStorage.setItem('loadedFileName', 'defaults/default-load.json');

                            // If there were warnings, set the warning UI flag.
                            const hasWarnings = (normalizedResult.issues || []).some(i => i && i.severity === 'warning') || (issues || []).some(i => i && i.severity === 'warning');
                            if (hasWarnings) {
                                try { localStorage.setItem('loadedFileWarn', '1'); } catch (_) {}
                                setLoadWarnUIFlag(true);
                            }
                        }
                    } catch (e) {
                        console.warn('⚠️ [ClearStorage] Failed to load default JSON after clear:', e);
                    }
                    
                    alert('ローカルストレージがクリアされました。デフォルト設計を読み込み、ページをリロードします。');
                    console.log('✅ ローカルストレージがクリアされました');
                    location.reload();
                } catch (error) {
                    console.error('❌ ローカルストレージクリアエラー:', error);
                    alert('ローカルストレージのクリアに失敗しました。');
                }
            }
        });
    }
}

/**
 * 近軸計算ボタンのイベントハンドラーを設定
 */
function setupParaxialButton() {
    const paraxialBtn = document.getElementById('calculate-paraxial-btn');
    if (paraxialBtn) {
        console.log('✅ 近軸計算ボタンが見つかりました');
        paraxialBtn.addEventListener('click', function() {
            console.log('📐 近軸計算ボタンがクリックされました');
            try {
                if (typeof window.outputParaxialDataToDebug === 'function') {
                    // テーブルインスタンスを取得して渡す
                    const tableOpticalSystem = window.tableOpticalSystem;
                    window.outputParaxialDataToDebug(tableOpticalSystem);
                    console.log('✅ 近軸計算が完了しました');
                } else {
                    console.error('❌ outputParaxialDataToDebug関数が見つかりません');
                }
            } catch (error) {
                console.error('❌ 近軸計算ボタンエラー:', error);
            }
        });
    } else {
        console.error('❌ 近軸計算ボタンが見つかりません');
    }
}

/**
 * Seidel係数計算ボタンのイベントハンドラーを設定
 */
function setupSeidelButton() {
    const seidelBtn = document.getElementById('calculate-seidel-btn');
    if (seidelBtn) {
        console.log('✅ Seidel係数計算ボタンが見つかりました');
        seidelBtn.addEventListener('click', function() {
            console.log('🔬 Seidel係数計算ボタンがクリックされました');
            try {
                if (typeof window.outputSeidelCoefficientsToDebug === 'function') {
                    window.outputSeidelCoefficientsToDebug();
                    console.log('✅ Seidel係数計算が完了しました');
                } else {
                    console.error('❌ outputSeidelCoefficientsToDebug関数が見つかりません');
                }
            } catch (error) {
                console.error('❌ Seidel係数計算ボタンエラー:', error);
            }
        });
    } else {
        console.error('❌ Seidel係数計算ボタンが見つかりません');
    }
}

/**
 * Seidel係数計算（アフォーカル系）ボタンのイベントハンドラーを設定
 */
async function setupSeidelAfocalButton() {
    const seidelAfocalBtn = document.getElementById('calculate-seidel-afocal-btn');
    if (seidelAfocalBtn) {
        console.log('✅ Seidel係数計算（アフォーカル）ボタンが見つかりました');
        seidelAfocalBtn.addEventListener('click', async function() {
            console.log('🔬 Seidel係数計算（アフォーカル）ボタンがクリックされました');
            try {
                const { calculateAfocalSeidelCoefficientsIntegrated } = await import('../eva-seidel-coefficients-afocal.js');
                const { formatSeidelCoefficients } = await import('../eva-seidel-coefficients.js');
                
                const opticalSystemRows = window.getOpticalSystemRows ? window.getOpticalSystemRows() : [];
                const objectRows = window.getObjectTableRows ? window.getObjectTableRows() : [];
                const sourceRows = window.getSourceTableRows ? window.getSourceTableRows() : [];
                
                if (opticalSystemRows.length === 0) {
                    console.error('❌ Optical system data is empty');
                    alert('光学系データがありません。');
                    return;
                }
                
                const wavelength = sourceRows.length > 0 && sourceRows[0].wavelength 
                    ? parseFloat(sourceRows[0].wavelength) 
                    : 0.5876;
                
                let stopIndex = opticalSystemRows.findIndex(row => 
                    row['object type'] === 'Stop' || row.object === 'Stop'
                );
                
                if (stopIndex === -1) {
                    console.warn('⚠️ Stop surface not found, using surface 1');
                    stopIndex = 1;
                }
                
                const refFLInput = document.getElementById('reference-focal-length');
                let referenceFocalLength = undefined;

                if (refFLInput) {
                    const raw = refFLInput.value.trim();
                    if (raw !== '' && raw.toLowerCase() !== 'auto') {
                        const parsed = parseFloat(raw);
                        referenceFocalLength = isFinite(parsed) ? parsed : undefined;
                    }
                }
                
                const result = calculateAfocalSeidelCoefficientsIntegrated(
                    opticalSystemRows, 
                    wavelength, 
                    stopIndex,
                    objectRows,
                    referenceFocalLength
                );
                
                if (!result) {
                    console.error('❌ Afocal Seidel coefficients calculation failed');
                    alert('アフォーカル系収差係数の計算に失敗しました。');
                    return;
                }
                
                const systemDataTextarea = document.getElementById('system-data');
                if (systemDataTextarea) {
                    systemDataTextarea.value = formatSeidelCoefficients(result);
                    console.log('✅ アフォーカル系Seidel係数計算が完了しました');

                    if (typeof window.renderBlockContributionSummaryFromSeidel === 'function') {
                        try {
                            window.renderBlockContributionSummaryFromSeidel(result, opticalSystemRows);
                        } catch (e) {
                            console.warn('⚠️ Block contribution summary render failed (afocal):', e);
                        }
                    }
                } else {
                    console.error('❌ System Data textarea not found');
                }
            } catch (error) {
                console.error('❌ アフォーカル系Seidel係数計算ボタンエラー:', error);
                alert(`エラーが発生しました: ${error.message}`);
            }
        });
    } else {
        console.error('❌ Seidel係数計算（アフォーカル）ボタンが見つかりません');
    }
}

/**
 * 座標変換ボタンのイベントハンドラーを設定
 */
function setupCoordinateTransformButton() {
    const coordBtn = document.getElementById('coord-transform-btn');
    if (coordBtn) {
        console.log('✅ 座標変換ボタンが見つかりました');
        coordBtn.addEventListener('click', function() {
            console.log('🔄 座標変換ボタンがクリックされました');
            try {
                if (typeof window.displayCoordinateTransformMatrix === 'function') {
                    window.displayCoordinateTransformMatrix();
                    console.log('✅ 座標変換表示が完了しました');
                } else {
                    console.error('❌ displayCoordinateTransformMatrix関数が見つかりません');
                }
            } catch (error) {
                console.error('❌ 座標変換ボタンエラー:', error);
            }
        });
    } else {
        console.error('❌ 座標変換ボタンが見つかりません');
    }
}

/**
 * スポットダイアグラムボタンのイベントハンドラーを設定
 */
function setupSpotDiagramButton() {
    const spotDiagramBtn = document.getElementById('show-spot-diagram-btn');
    if (spotDiagramBtn) {
        spotDiagramBtn.addEventListener('click', async function() {
            try {
                await showSpotDiagram();
            } catch (error) {
                console.error('❌ スポットダイアグラムエラー:', error);
                alert(`スポットダイアグラムエラー: ${error.message}`);
            }
        });
    }
}

/**
 * 縦収差図ボタンのイベントハンドラーを設定（Longitudinal Aberration）
 */
function setupLongitudinalAberrationButton() {
    const longitudinalAberrationBtn = document.getElementById('show-longitudinal-aberration-diagram-btn');
    if (longitudinalAberrationBtn) {
        longitudinalAberrationBtn.addEventListener('click', async function() {
            try {
                await showLongitudinalAberrationDiagram();
            } catch (error) {
                console.error('❌ 縦収差図エラー:', error);
                alert(`縦収差図エラー: ${error.message}`);
            }
        });
    }
}

/**
 * 横収差図ボタンのイベントハンドラーを設定
 */
function setupTransverseAberrationButton() {
    const transverseAberrationBtn = document.getElementById('show-transverse-aberration-diagram-btn');
    if (transverseAberrationBtn) {
        transverseAberrationBtn.addEventListener('click', async function() {
            try {
                await showTransverseAberrationDiagram();
            } catch (error) {
                console.error('❌ 横収差図エラー:', error);
                alert(`横収差図エラー: ${error.message}`);
            }
        });
    }
}

/**
 * 歪曲収差図ボタンのイベントハンドラーを設定
 */
function setupDistortionButton() {
    const distortionBtn = document.getElementById('show-distortion-diagram-btn');
    if (distortionBtn) {
        distortionBtn.addEventListener('click', async function() {
            try {
                console.log('📐 歪曲収差図の生成開始...');
                
                // generateDistortionPlots は main.js でグローバル公開済み
                if (typeof window.generateDistortionPlots !== 'function') {
                    throw new Error('generateDistortionPlots 関数が見つかりません');
                }
                
                const data = window.generateDistortionPlots();
                if (!data) {
                    throw new Error('歪曲収差データの計算に失敗しました');
                }
                
                console.log('✅ 歪曲収差図の生成完了');
            } catch (error) {
                console.error('❌ 歪曲収差図エラー:', error);
                alert(`歪曲収差図エラー: ${error.message}`);
            }
        });
    }

    // Grid distortion button
    const gridBtn = document.getElementById('show-distortion-grid-btn');
    if (gridBtn) {
        gridBtn.addEventListener('click', async function() {
            try {
                console.log('📐 グリッド歪曲図の生成開始...');
                
                if (typeof window.generateGridDistortionPlot !== 'function') {
                    throw new Error('generateGridDistortionPlot 関数が見つかりません');
                }
                
                const gridSizeSelect = document.getElementById('grid-size-select');
                const gridSize = gridSizeSelect ? parseInt(gridSizeSelect.value) : 20;
                
                const data = window.generateGridDistortionPlot({ gridSize });
                if (!data) {
                    throw new Error('グリッド歪曲データの計算に失敗しました');
                }
                
                console.log('✅ グリッド歪曲図の生成完了');
            } catch (error) {
                console.error('❌ グリッド歪曲図エラー:', error);
                alert(`グリッド歪曲図エラー: ${error.message}`);
            }
        });
    }
}

/**
 * 統合収差図ボタンのイベントハンドラーを設定
 */
function setupIntegratedAberrationButton() {
    const integratedBtn = document.getElementById('show-integrated-aberration-btn');
    if (integratedBtn) {
        integratedBtn.addEventListener('click', async function() {
            try {
                console.log('📊 統合収差図の生成開始...');
                
                // showIntegratedAberrationDiagram を呼び出す
                if (typeof window.showIntegratedAberrationDiagram !== 'function') {
                    throw new Error('showIntegratedAberrationDiagram 関数が見つかりません');
                }
                
                await window.showIntegratedAberrationDiagram();
                
                console.log('✅ 統合収差図の生成完了');
            } catch (error) {
                console.error('❌ 統合収差図エラー:', error);
                alert(`統合収差図エラー: ${error.message}`);
            }
        });
    }
}

/**
 * 非点収差図ボタンのイベントハンドラーを設定
 */
function setupAstigmatismButton() {
    const astigmatismBtn = document.getElementById('show-astigmatism-diagram-btn');
    if (astigmatismBtn) {
        astigmatismBtn.addEventListener('click', async function() {
            try {
                await showAstigmatismDiagram();
            } catch (error) {
                console.error('❌ 非点収差図エラー:', error);
                alert(`非点収差図エラー: ${error.message}`);
            }
        });
    }
}

/**
 * 波面収差図のObject選択オプションを更新
 */
function updateWavefrontObjectOptions() {
    const objectSelect = document.getElementById('wavefront-object-select');
    if (!objectSelect) return;
    
    try {
        // Objectテーブルからデータを取得
        const objectTable = window.tableObject || window.objectTabulator || window.objectTable;
        if (!objectTable) {
            console.warn('⚠️ Object テーブルが見つかりません');
            return;
        }
        
        const objectData = objectTable.getData();
        
        // 有効なObjectデータのみをフィルタリング
        const validObjectData = objectData.filter((obj, index) => {
            // 空行やundefinedを除外
            if (!obj || obj.id === undefined || obj.id === null) {
                console.log(`🚫 無効なObject[${index}]をスキップ:`, obj);
                return false;
            }
            return true;
        });
        
        // デバッグ: 実際のObjectデータを確認
        console.log('🔍 全Objectデータ:', objectData);
        console.log('� 有効Objectデータ:', validObjectData);
        console.log('�📊 全Objectデータ数:', objectData.length);
        console.log('📊 有効Objectデータ数:', validObjectData.length);
        
        // ローカルストレージのデータが多すぎる場合の警告
        if (objectData.length > 6) {
            console.warn('⚠️ Objectデータが多すぎます。Clear Storageボタンでリセットしてください。');
        }
        
        // 既存のオプションをクリア
        objectSelect.innerHTML = '';
        
        // Objectが存在しない場合
        if (!validObjectData || validObjectData.length === 0) {
            const option = document.createElement('option');
            option.value = '0';
            option.textContent = 'No Objects';
            option.disabled = true;
            objectSelect.appendChild(option);
            return;
        }
        
        // 各Objectのオプションを追加
        validObjectData.forEach((obj, index) => {
            console.log(`🔍 有効Object[${index}]:`, obj);
            
            const option = document.createElement('option');
            option.value = index.toString();
            
            // Object表示名を生成（座標情報含む）
            const xValue = (obj.x ?? obj.xHeightAngle ?? 0);
            const yValue = (obj.y ?? obj.yHeightAngle ?? 0);
            const objectName = `Object ${index + 1} (${xValue.toFixed(2)}, ${yValue.toFixed(2)})`;
            
            option.textContent = objectName;
            objectSelect.appendChild(option);
        });
        
        console.log(`📊 波面収差図Object選択更新: ${validObjectData.length}個の有効Object`);
        
    } catch (error) {
        console.error('❌ Object選択オプション更新エラー:', error);
        
        // エラー時のフォールバック
        objectSelect.innerHTML = '';
        const option = document.createElement('option');
        option.value = '0';
        option.textContent = 'Object 1';
        objectSelect.appendChild(option);
    }
}

// 外部（Configuration切替など）から呼べるように公開
if (typeof window !== 'undefined') {
    window.updateWavefrontObjectOptions = updateWavefrontObjectOptions;
}

/**
 * 波面収差図ボタンのイベントハンドラーを設定
 */
function setupWavefrontAberrationButton() {
    const wavefrontBtn = document.getElementById('show-wavefront-diagram-btn');
    const stopBtn = document.getElementById('stop-opd-btn');
    const progressEl = document.getElementById('opd-progress');
    
    let activeOpdCancelToken = null;
    
    if (wavefrontBtn) {
        wavefrontBtn.addEventListener('click', async function() {
            try {
                // UIから設定を取得
                const objectSelect = document.getElementById('wavefront-object-select');
                const plotTypeSelect = document.getElementById('wavefront-plot-type-select');
                const gridSizeSelect = document.getElementById('wavefront-grid-size-select');
                
                const selectedObjectIndex = objectSelect ? parseInt(objectSelect.value) : 0;
                const plotType = plotTypeSelect ? plotTypeSelect.value : 'surface';
                const dataType = 'opd'; // Optical Path Difference固定
                const gridSize = gridSizeSelect ? parseInt(gridSizeSelect.value) : 64;
                
                console.log(`🌊 光路差表示: Object${selectedObjectIndex + 1}, ${plotType}, ${dataType}, gridSize=${gridSize}`);
                
                // Create cancel token
                activeOpdCancelToken = createCancelToken();
                
                // Enable Stop button
                if (stopBtn) {
                    stopBtn.disabled = false;
                    stopBtn.textContent = 'Stop';
                }
                
                // Progress callback (supported by generateWavefrontMap)
                const onProgress = (evt) => {
                    try {
                        if (!progressEl) return;
                        const p = Number(evt?.percent);
                        const msg = evt?.message || evt?.phase || 'Working...';
                        if (Number.isFinite(p)) {
                            progressEl.textContent = `${msg} (${Math.round(p)}%)`;
                        } else {
                            progressEl.textContent = msg;
                        }
                    } catch (_) {}
                };
                
                try {
                    await showWavefrontDiagram(plotType, dataType, gridSize, selectedObjectIndex, {
                        cancelToken: activeOpdCancelToken,
                        onProgress
                    });
                    if (progressEl) progressEl.textContent = 'OPD calculation completed';
                } catch (err) {
                    if (err?.message?.includes('Cancelled')) {
                        if (progressEl) progressEl.textContent = 'OPD calculation cancelled';
                        console.log('🛑 OPD calculation cancelled by user');
                    } else {
                        throw err;
                    }
                } finally {
                    // Disable Stop button
                    if (stopBtn) {
                        stopBtn.disabled = true;
                        stopBtn.textContent = 'Stop';
                    }
                    activeOpdCancelToken = null;
                }
            } catch (error) {
                console.error('❌ 波面収差図エラー:', error);
                if (progressEl) progressEl.textContent = '';
                alert(`波面収差図エラー: ${error.message}`);
            }
        });
    }
    
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            console.log('🛑 OPD Stop button clicked');
            if (activeOpdCancelToken && typeof activeOpdCancelToken.abort === 'function') {
                activeOpdCancelToken.abort('Stopped by user');
                if (stopBtn) {
                    stopBtn.disabled = true;
                    stopBtn.textContent = 'Stopping...';
                }
            }
        });
    }

    const zernikeBtn = document.getElementById('zernike-fit-btn');
    if (zernikeBtn) {
        zernikeBtn.addEventListener('click', function() {
            const map = window.__lastWavefrontMap;
            const fit = map?.zernike;
            if (!map || !fit) {
                alert('Zernike Fit: 先に「Show wavefront diagram」または「Draw OPD Rays」を実行してください。');
                return;
            }

            const cMic = fit.coefficientsMicrons || {};
            const cWav = fit.coefficientsWaves || {};
            const stats = fit.stats || {};

            const lines = [];
            lines.push('Zernike Fit (Noll index)');
            lines.push(`points: ${stats.points ?? 'n/a'}`);
            if (isFinite(stats.rmsResidual)) {
                lines.push(`rms residual: ${stats.rmsResidual.toFixed(6)} μm`);
            }
            lines.push('');
            lines.push('Removed (reference-sphere W): 1(piston),2(tilt x),3(tilt y),5(defocus)');
            lines.push('');

            const fmt = (v) => (isFinite(v) ? v.toFixed(6) : 'n/a');
            const wfmt = (v) => (isFinite(v) ? v.toFixed(6) : 'n/a');

            lines.push(`1 piston : ${fmt(cMic[1])} μm  (${wfmt(cWav[1])} waves)`);
            lines.push(`2 tilt x : ${fmt(cMic[2])} μm  (${wfmt(cWav[2])} waves)`);
            lines.push(`3 tilt y : ${fmt(cMic[3])} μm  (${wfmt(cWav[3])} waves)`);
            lines.push(`5 defocus: ${fmt(cMic[5])} μm  (${wfmt(cWav[5])} waves)`);

            if (map.statistics?.raw?.opdMicrons && map.statistics?.opdMicrons) {
                const raw = map.statistics.raw.opdMicrons;
                const corr = map.statistics.opdMicrons;
                lines.push('');
                lines.push(`OPD RMS: raw=${raw.rms.toFixed(6)} μm, corrected=${corr.rms.toFixed(6)} μm`);
                lines.push(`OPD P-V:  raw=${raw.peakToPeak.toFixed(6)} μm, corrected=${corr.peakToPeak.toFixed(6)} μm`);
            }

            alert(lines.join('\n'));
        });
    }

    // PSF計算ボタンのイベントハンドラー（新しいPSF計算システムを使用）
    const psfBtn = document.getElementById('show-psf-btn');
    if (psfBtn) {
        psfBtn.addEventListener('click', async function() {
            try {
                console.log('🔬 [PSF] Show PSF button clicked - using advanced PSF calculation system');
                
                // 新しいPSF計算システムを使用（オブジェクト選択を正しく反映）
                await handlePSFCalculation(false); // 通常モード
            } catch (error) {
                console.error('❌ PSF計算エラー:', error);
                alert(`PSF計算エラー: ${error.message}`);
            }
        });
    }

    const psfStopBtn = document.getElementById('stop-psf-btn');
    if (psfStopBtn) {
        psfStopBtn.addEventListener('click', function() {
            try {
                const t = window.__psfActiveCancelToken;
                if (t && typeof t.abort === 'function') {
                    t.abort('Stopped by user');
                }
            } catch (_) {}
        });
    }
}

/**
 * 面番号選択の更新（旧関数の互換性のため）
 */
function updateSurfaceNumberSelectLegacy() {
    // Debounce/throttle to avoid noisy repeated updates from table events.
    const now = Date.now();
    const lastAt = Number(window.__lastSurfaceSelectUpdateAt || 0);
    if (now - lastAt < 200) return;
    window.__lastSurfaceSelectUpdateAt = now;

    const surfaceSelect = document.getElementById('surface-number-select');
    
    if (!surfaceSelect) return;
    
    // 既存のオプションをクリア
    surfaceSelect.innerHTML = '<option value="">面を選択...</option>';
    
    try {
        const resolveOpticalRowsForSpotConfig = () => {
            try {
                const cfgSel = document.getElementById('spot-diagram-config-select');
                const selected = cfgSel && cfgSel.value !== undefined && cfgSel.value !== null ? String(cfgSel.value).trim() : '';
                if (!selected) return getOpticalSystemRows();

                const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem('systemConfigurations') : null;
                if (!raw) return getOpticalSystemRows();
                const sys = JSON.parse(raw);
                const cfg = Array.isArray(sys?.configurations)
                    ? sys.configurations.find(c => String(c?.id) === selected)
                    : null;

                // If this selected config is the active one, prefer live tables.
                const activeId = (sys && sys.activeConfigId !== undefined && sys.activeConfigId !== null)
                    ? String(sys.activeConfigId)
                    : '';
                if (activeId && selected === activeId) return getOpticalSystemRows();

                // Prefer expanded blocks (with active scenario overrides) when available,
                // to keep Spot Diagram surface options consistent with evaluation.
                const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
                const cloneJson = (v) => {
                    try { return JSON.parse(JSON.stringify(v)); } catch { return null; }
                };
                const parseOverrideKey = (variableId) => {
                    const s = String(variableId ?? '');
                    const dot = s.indexOf('.');
                    if (dot <= 0) return null;
                    const blockId = s.slice(0, dot);
                    const key = s.slice(dot + 1);
                    if (!blockId || !key) return null;
                    return { blockId, key };
                };
                const applyOverridesToBlocks = (blocks, overrides) => {
                    const cloned = cloneJson(blocks);
                    if (!Array.isArray(cloned)) return Array.isArray(blocks) ? blocks : [];
                    if (!isPlainObject(overrides)) return cloned;

                    const byId = new Map();
                    for (const b of cloned) {
                        const id = isPlainObject(b) ? String(b.blockId ?? '') : '';
                        if (id) byId.set(id, b);
                    }
                    for (const [varId, rawVal] of Object.entries(overrides)) {
                        const parsedKey = parseOverrideKey(varId);
                        if (!parsedKey) continue;
                        const blk = byId.get(String(parsedKey.blockId));
                        if (!blk || !isPlainObject(blk.parameters)) continue;
                        const n = Number(rawVal);
                        blk.parameters[parsedKey.key] = Number.isFinite(n) ? n : rawVal;
                    }
                    return cloned;
                };

                try {
                    if (cfg && Array.isArray(cfg.blocks) && cfg.blocks.length > 0 && typeof expandBlocksToOpticalSystemRows === 'function') {
                        const blocksHaveObjectPlane = (() => {
                            try { return cfg.blocks.some(b => String(b?.blockType ?? '').trim() === 'ObjectPlane'); } catch (_) { return false; }
                        })();
                        const scenarios = Array.isArray(cfg.scenarios) ? cfg.scenarios : null;
                        const scenarioId = cfg.activeScenarioId ? String(cfg.activeScenarioId) : '';
                        const scn = (scenarioId && scenarios)
                            ? scenarios.find(s => s && String(s.id) === String(scenarioId))
                            : null;
                        const overrides = scn && isPlainObject(scn.overrides) ? scn.overrides : null;
                        const blocksToExpand = overrides ? applyOverridesToBlocks(cfg.blocks, overrides) : cfg.blocks;
                        const exp = expandBlocksToOpticalSystemRows(blocksToExpand);
                        const expRows = exp && Array.isArray(exp.rows) ? exp.rows : null;
                        if (expRows && expRows.length > 0) {
                            if (!blocksHaveObjectPlane) {
                                const preferredThickness = cfg?.opticalSystem?.[0]?.thickness;
                                if (preferredThickness !== undefined && preferredThickness !== null && String(preferredThickness).trim() !== '') {
                                    expRows[0] = { ...expRows[0], thickness: preferredThickness };
                                }
                            }
                            return expRows;
                        }
                    }
                } catch (_) {}

                const rows = cfg && Array.isArray(cfg.opticalSystem) ? cfg.opticalSystem : null;
                return Array.isArray(rows) ? rows : getOpticalSystemRows();
            } catch (_) {
                return getOpticalSystemRows();
            }
        };

        const opticalSystemRows = resolveOpticalRowsForSpotConfig();
        if (opticalSystemRows && opticalSystemRows.length > 0) {
            const surfaceOptions = generateSurfaceOptions(opticalSystemRows);
            let imageSurfaceValue = null;
            let lastSurfaceValue = null;
            
            surfaceOptions.forEach(option => {
                // スポットダイアグラム用のセレクト
                const optionElement = document.createElement('option');
                optionElement.value = option.value;
                optionElement.textContent = option.label;
                surfaceSelect.appendChild(optionElement);
                
                // Image面を探す
                if (option.label.includes('(Image)')) {
                    imageSurfaceValue = option.value;
                }
                
                // 最後の面を記録（Image面がない場合の代替）
                lastSurfaceValue = option.value;
            });
            
            // Image面が見つかった場合、それを初期選択値として設定
            const defaultValue = imageSurfaceValue !== null ? imageSurfaceValue : lastSurfaceValue;
            
            if (defaultValue !== null) {
                surfaceSelect.value = defaultValue;
            }

            const sig = `${surfaceOptions.length}::${String(defaultValue ?? '')}`;
            if (window.__lastSurfaceSelectSignature !== sig) {
                window.__lastSurfaceSelectSignature = sig;
                console.log(`✅ 面選択が${surfaceOptions.length}個のオプションで更新されました`);
            }
        }
    } catch (error) {
        console.error('❌ 面選択更新エラー:', error);
    }
}

function setupSpotDiagramConfigSelect() {
    const select = document.getElementById('spot-diagram-config-select');
    if (!select) return;

    const rebuildOptions = () => {
        try {
            const prev = (select.value !== undefined && select.value !== null) ? String(select.value) : '';
            let desired = prev;

            // Restore from lastSpotDiagramSettings if present.
            try {
                const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem('lastSpotDiagramSettings') : null;
                if (raw) {
                    const s = JSON.parse(raw);
                    const v = (s && s.configId !== undefined && s.configId !== null) ? String(s.configId).trim() : '';
                    if (v) desired = v;
                }
            } catch (_) {}

            const rawCfg = (typeof localStorage !== 'undefined') ? localStorage.getItem('systemConfigurations') : null;
            const sys = rawCfg ? JSON.parse(rawCfg) : null;
            const configs = Array.isArray(sys?.configurations) ? sys.configurations : [];
            const activeId = (sys && sys.activeConfigId !== undefined && sys.activeConfigId !== null) ? String(sys.activeConfigId) : '';
            const activeName = configs.find(c => String(c?.id) === activeId)?.name;

            select.innerHTML = '';

            const optCurrent = document.createElement('option');
            optCurrent.value = '';
            optCurrent.textContent = activeName ? `Current (${activeName})` : 'Current';
            select.appendChild(optCurrent);

            for (const c of configs) {
                const id = (c && c.id !== undefined && c.id !== null) ? String(c.id) : '';
                if (!id) continue;
                const opt = document.createElement('option');
                opt.value = id;
                const name = String(c?.name ?? `Config ${id}`);
                opt.textContent = (id === activeId) ? `${name} ★` : name;
                select.appendChild(opt);
            }

            // Keep selection if it still exists.
            const hasDesired = desired && Array.from(select.options).some(o => String(o.value) === String(desired));
            select.value = hasDesired ? desired : '';
        } catch (e) {
            console.warn('⚠️ Spot Diagram config select rebuild failed:', e);
        }
    };

    if (!select.__cooptSpotCfgInit) {
        select.__cooptSpotCfgInit = true;
        select.addEventListener('change', () => {
            try {
                // Update surface list to match selected config.
                updateSurfaceNumberSelectLegacy();
            } catch (_) {}

            // Persist selection (best effort) so popup/requirements can mirror it.
            try {
                const current = (select.value !== undefined && select.value !== null) ? String(select.value).trim() : '';
                const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem('lastSpotDiagramSettings') : null;
                const s = raw ? (JSON.parse(raw) || {}) : {};
                s.configId = current || null;
                s.updatedAt = Date.now();
                localStorage.setItem('lastSpotDiagramSettings', JSON.stringify(s));
            } catch (_) {}
        });
    }

    rebuildOptions();

    // Expose for other modules (e.g. configuration switch) to refresh options.
    try {
        if (typeof window !== 'undefined') {
            window.updateSpotDiagramConfigSelect = rebuildOptions;
        }
    } catch (_) {}
}

/**
 * PSF計算ボタンのイベントハンドラーを設定
 */
function setupPSFCalculationButton() {
    const calculatePsfBtn = document.getElementById('calculate-psf-btn');
    console.log('🔍 [PSF] setupPSFCalculationButton called, button found:', !!calculatePsfBtn);
    if (calculatePsfBtn) {
        calculatePsfBtn.addEventListener('click', async function() {
            await handlePSFCalculation(false); // 通常モード
        });
    }
}

/**
 * デバッグPSF計算ボタンのイベントハンドラーを設定
 */
function setupDebugPSFCalculationButton() {
    const debugPsfBtn = document.getElementById('debug-psf-btn');
    console.log('🔧 [DEBUG] setupDebugPSFCalculationButton called, button found:', !!debugPsfBtn);
    if (debugPsfBtn) {
        debugPsfBtn.addEventListener('click', async function() {
            await handlePSFCalculation(true); // デバッグモード
        });
    }
}

/**
 * PSF計算処理の共通関数
 * @param {boolean} debugMode - デバッグモードかどうか
 */
async function handlePSFCalculation(debugMode = false) {
    console.log(`🔬 [PSF] PSF計算ボタンがクリックされました (デバッグモード: ${debugMode})`);
    
    // 選択されたオブジェクトを取得
    const psfObjectSelect = document.getElementById('psf-object-select');
    console.log('🔍 [PSF] PSF object select:', {
        element: !!psfObjectSelect,
        value: psfObjectSelect?.value,
        options: psfObjectSelect?.options ? Array.from(psfObjectSelect.options).map(o => ({text: o.text, value: o.value})) : 'none'
    });
    
    if (!psfObjectSelect || !psfObjectSelect.value) {
        console.warn('⚠️ [PSF] PSF object not selected');
        alert('PSF計算のためのオブジェクトを選択してください');
        return;
    }
    
    const selectedObjectIndex = parseInt(psfObjectSelect.value);
    const objectRows = getObjectRows();
    if (!objectRows || selectedObjectIndex >= objectRows.length) {
        alert('選択されたオブジェクトが無効です');
        return;
    }
    
    const selectedObject = objectRows[selectedObjectIndex];
    
    // PSF UIからパラメータを取得
    const wavelengthSelect = document.getElementById('psf-wavelength-select'); // 現在存在しない
    const gridSizeSelect = document.getElementById('psf-grid-size-select'); // 現在存在しない
    const samplingSelect = document.getElementById('psf-sampling-select'); // PSF UIのサンプリングサイズ
    const zernikeSamplingSelect = document.getElementById('psf-zernike-sampling-select'); // Zernikeフィット用サンプリングサイズ
    
    // デバッグモードの場合は設定を上書き
    let wavelength, psfSamplingSize, zernikeFitSamplingSize;
    if (debugMode) {
        wavelength = '0.5876'; // d線固定
        psfSamplingSize = 16; // 16×16グリッド固定（高速）
        zernikeFitSamplingSize = 16;
        console.log('🔧 [DEBUG] デバッグモード: wavelength=0.5876μm, gridSize=16×16に固定');
    } else {
        // 光源データから波長を取得
        const sources = window.getSourceRows ? window.getSourceRows() : (window.sources || []);
        // Sourceテーブルの主波長を優先
        if (typeof window !== 'undefined' && typeof window.getPrimaryWavelength === 'function') {
            wavelength = Number(window.getPrimaryWavelength()) || 0.5876;
        } else {
            wavelength = (sources && sources.length > 0) ? (sources[0].wavelength || 0.5876) : 0.5876;
        }
        
        // PSF UIのサンプリング設定を使用（既定は64x64）
        psfSamplingSize = samplingSelect ? parseInt(samplingSelect.value) : 64;
        // Zernikeフィット用のサンプリング（未設定ならPSFと同じ）
        zernikeFitSamplingSize = zernikeSamplingSelect ? parseInt(zernikeSamplingSelect.value) : psfSamplingSize;
        console.log(`📊 [NORMAL] 通常モード: wavelength=${wavelength}μm (source), psfSampling=${psfSamplingSize}×${psfSamplingSize}, fitGrid=${zernikeFitSamplingSize}×${zernikeFitSamplingSize}`);
    }
    
    console.log(`🔬 PSFパラメータ: wavelength=${wavelength}, psfSampling=${psfSamplingSize}, fitGrid=${zernikeFitSamplingSize}, debugMode=${debugMode}`);
    
    // 光学系データを取得
    const opticalSystemRows = getOpticalSystemRows();
    if (!opticalSystemRows || opticalSystemRows.length === 0) {
        alert('光学系データが見つかりません。まず光学系を設定してください。');
        return;
    }
    
    // Install cancel token for this run (Stop button)
    const cancelToken = createCancelToken();
    window.__psfActiveCancelToken = cancelToken;
    try {
        const stopBtn = document.getElementById('stop-psf-btn');
        if (stopBtn) stopBtn.disabled = false;
    } catch (_) {}

    try {
        // 選択されたオブジェクトからフィールド設定を作成
        // NOTE: Objectテーブルの実データは設計によりキーが揺れるため、ここで頑健に解決する。
        // （過去の createFieldSettingFromObject は position/xHeightAngle 前提で、0,0 に潰れてPSFが不変になり得る）
        console.log('🔧 オブジェクトからフィールド設定を作成中:', selectedObject);

        const wl = (Number.isFinite(Number(wavelength)) && Number(wavelength) > 0) ? Number(wavelength) : 0.5876;
        const objectX = (selectedObject?.x ?? selectedObject?.xHeightAngle ?? selectedObject?.x_height_angle ?? 0);
        const objectY = (selectedObject?.y ?? selectedObject?.yHeightAngle ?? selectedObject?.y_height_angle ?? 0);
        const objectTypeRaw = String(selectedObject?.position ?? selectedObject?.object ?? selectedObject?.Object ?? selectedObject?.objectType ?? 'Point');
        const objectType = objectTypeRaw;
        const objectTypeLower = objectTypeRaw.toLowerCase();

        let fieldAngle = { x: 0, y: 0 };
        let xHeight = 0;
        let yHeight = 0;

        // IMPORTANT: 'rectangle' contains the substring 'angle'.
        // Use a word-boundary test so Rectangle is not treated as Angle.
        if (/\bangle\b/.test(objectTypeLower)) {
            // Angle (deg): interpret as field angle. Solver selection is handled by eva-wavefront.js.
            fieldAngle = { x: Number(objectX) || 0, y: Number(objectY) || 0 };
            xHeight = 0;
            yHeight = 0;
        } else {
            fieldAngle = { x: 0, y: 0 };
            xHeight = Number(objectX) || 0;
            yHeight = Number(objectY) || 0;
        }

        const fieldSetting = {
            objectIndex: selectedObjectIndex,
            type: objectType,
            fieldAngle,
            xHeight,
            yHeight,
            wavelength: wl
        };

        console.log('✅ フィールド設定が作成されました:', fieldSetting);
        
        // ローディングオーバーレイを表示
        showPSFLoadingOverlay(psfSamplingSize, wavelength, debugMode);
        
        const PSF_DEBUG = !!debugMode || !!(typeof globalThis !== 'undefined' && globalThis.__PSF_DEBUG);

        // PSFを計算
        if (PSF_DEBUG) console.log('🔬 PSF計算を開始...');
        
        let psfResult;
        
    // PSF計算タイムアウト設定（要求により無効化可能）
    const DISABLE_PSF_TIMEOUT = true; // タイムアウトを完全に無効化
    const PSF_TIMEOUT = debugMode ? 10000 : 60000; // 無効化時は未使用
        const psfCalculationPromise = (async () => {
            throwIfCancelled(cancelToken);
            // PSFCalculatorを使用した単色PSF計算
            const modeText = debugMode ? 'デバッグモード' : '通常モード';
            if (PSF_DEBUG) {
                console.log(`🔬 λ=${wavelength}μmの単色PSFを計算中... (${modeText})`);
                console.log('🔍 PSF計算パラメータ:', {
                    opticalSystemRows: opticalSystemRows?.length || 0,
                    fieldSetting: fieldSetting,
                    wavelength: wavelength,
                    psfSamplingSize: psfSamplingSize,
                    zernikeFitSamplingSize: zernikeFitSamplingSize,
                    debugMode: debugMode
                });
            }
            
            // 必要なモジュールを動的インポート
            // PSFCalculator はシングルトンで再利用（WASM初期化を使い回す）
            const { createOPDCalculator, WavefrontAberrationAnalyzer } = await import('../eva-wavefront.js');

            // PSF入力のOPDは「Zernikeでフィットした関数面」を直接サンプリングして作る
            // - 数値的な外れ値除去/平滑化はしない
            // - OPD表示仕様と同様に piston/tilt は除去、defocus は残す（usedCoefficientsMicrons）
            if (PSF_DEBUG) console.log('📊 [PSF] Zernikeフィット面からOPD格子を生成中...');
            const opdCalculator = createOPDCalculator(opticalSystemRows, wl);
            const analyzer = new WavefrontAberrationAnalyzer(opdCalculator);
            const wavefrontMap = await analyzer.generateWavefrontMap(fieldSetting, zernikeFitSamplingSize, 'circular', {
                recordRays: false,
                progressEvery: 0,
                zernikeMaxNoll: 36,
                renderFromZernike: true,
                cancelToken
            });

            throwIfCancelled(cancelToken);

            if (wavefrontMap?.error) {
                const err = new Error(wavefrontMap.error?.message || 'Wavefront generation failed');
                err.code = 'WAVEFRONT_UNAVAILABLE';
                err.wavefrontError = wavefrontMap.error;
                throw err;
            }

            // PSFでは tilt を使いたいので、表示用(tilt除去)ではなくフィット係数（生）を使用して面を評価する
            const model = wavefrontMap?.zernikeModel;
            const savedUsed = model?.usedCoefficientsMicrons;
            try {
                if (model?.fitCoefficientsMicrons && typeof model.fitCoefficientsMicrons === 'object') {
                    model.usedCoefficientsMicrons = { ...model.fitCoefficientsMicrons };
                }
            } catch (_) {
                // ignore
            }

            const zGrid = analyzer.generateZernikeRenderGrid(wavefrontMap, psfSamplingSize, 'opd', { rhoMax: 1.0 });

            throwIfCancelled(cancelToken);

            try {
                if (model) model.usedCoefficientsMicrons = savedUsed;
            } catch (_) {
                // ignore
            }
            if (!zGrid || !Array.isArray(zGrid.z) || !Array.isArray(zGrid.z[0])) {
                throw new Error('Zernike render grid generation failed');
            }

            const s = Math.max(2, Math.floor(Number(psfSamplingSize)));
            // Row-major [y][x]
            const opdGrid = Array.from({ length: s }, () => new Float32Array(s));
            const ampGrid = Array.from({ length: s }, () => new Float32Array(s));
            const maskGrid = Array.from({ length: s }, () => Array(s).fill(false));
            const xCoords = new Float32Array(s);
            const yCoords = new Float32Array(s);

            for (let i = 0; i < s; i++) {
                xCoords[i] = Number(zGrid.x?.[i] ?? ((i / (s - 1 || 1)) * 2 - 1));
                yCoords[i] = Number(zGrid.y?.[i] ?? ((i / (s - 1 || 1)) * 2 - 1));
            }

            for (let iy = 0; iy < s; iy++) {
                if ((iy % 32) === 0) {
                    throwIfCancelled(cancelToken);
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
                const row = zGrid.z[iy];
                for (let ix = 0; ix < s; ix++) {
                    const vWaves = row?.[ix];
                    if (vWaves === null || !isFinite(vWaves)) {
                        maskGrid[iy][ix] = false;
                        opdGrid[iy][ix] = 0;
                        ampGrid[iy][ix] = 0;
                        continue;
                    }
                    maskGrid[iy][ix] = true;
                    opdGrid[iy][ix] = Number(vWaves) * wl;
                    ampGrid[iy][ix] = 1.0;
                }
            }

            const opdData = {
                gridSize: s,
                wavelength: wl,
                gridData: {
                    opd: opdGrid,
                    amplitude: ampGrid,
                    pupilMask: maskGrid,
                    xCoords,
                    yCoords
                }
            };
            
            // PSF計算器を初期化（WASM統合版）
            const psfCalculator = await getPSFCalculatorSingleton();

            throwIfCancelled(cancelToken);
            
            // パフォーマンス設定を取得
            const performanceSelect = document.getElementById('psf-performance-select');
            const performanceMode = performanceSelect ? performanceSelect.value : 'auto';
            
            // PSFを計算
            if (PSF_DEBUG) console.log(`🔬 [PSF] PSF計算中... (${psfSamplingSize}x${psfSamplingSize}, mode: ${performanceMode})`);
            const result = await raceWithCancel(psfCalculator.calculatePSF(opdData, {
                samplingSize: psfSamplingSize,
                pupilDiameter: 10.0, // mm（適切な値に調整）
                focalLength: 100.0,   // mm（適切な値に調整）
                forceImplementation: performanceMode === 'auto' ? null : performanceMode,
                removeTilt: false
            }), cancelToken);
            
            // WASM使用状況をログ
            const wasmStatus = psfCalculator.getWasmStatus();
            if (PSF_DEBUG) {
                console.log('🔍 PSF計算完了、結果:', {
                    hasResult: !!result,
                    resultType: typeof result,
                    resultKeys: result ? Object.keys(result) : 'none',
                    wasmStatus: wasmStatus,
                    calculator: result?.metadata?.method || 'unknown',
                    executionTime: result?.metadata?.executionTime || 'unknown',
                    debugMode: debugMode
                });
            }
            
            return result;
        })();
        
        if (DISABLE_PSF_TIMEOUT) {
            // タイムアウトを無効化して計算完了まで待機
            psfResult = await raceWithCancel(psfCalculationPromise, cancelToken);
        } else {
            // タイムアウト処理
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`PSF計算がタイムアウトしました (${PSF_TIMEOUT/1000}秒)`));
                }, PSF_TIMEOUT);
            });

            try {
                psfResult = await Promise.race([raceWithCancel(psfCalculationPromise, cancelToken), timeoutPromise]);
            } catch (timeoutError) {
                console.error('❌ PSF計算タイムアウト:', timeoutError);

                // ローディングオーバーレイを非表示
                hidePSFLoadingOverlay();

                const psfContainer = document.getElementById('psf-container');
                if (psfContainer) {
                    psfContainer.innerHTML = `
                        <div style="padding: 20px; text-align: center; color: #d32f2f; border: 1px solid #d32f2f; border-radius: 5px; background-color: #ffebee;">
                            <h3>PSF計算タイムアウト</h3>
                            <p>PSF計算が${PSF_TIMEOUT/1000}秒以内に完了しませんでした。</p>
                            <p>以下を試してください：</p>
                            <ul style="text-align: left; margin: 10px 0;">
                                <li>グリッドサイズを小さくする（64×64など）</li>
                                <li>光学系の設定を確認する</li>
                                <li>ブラウザを再読み込みする</li>
                            </ul>
                        </div>
                    `;
                }
                return;
            }
        }
        
        if (!psfResult) {
            console.error('❌ PSF計算がnull結果を返しました');
            
            // ローディングオーバーレイを非表示
            hidePSFLoadingOverlay();
            
            const psfContainer = document.getElementById('psf-container');
            if (psfContainer) {
                psfContainer.innerHTML = `
                    <div style="padding: 20px; text-align: center; color: #d32f2f; border: 1px solid #d32f2f; border-radius: 5px; background-color: #ffebee;">
                        <h3>PSF計算エラー</h3>
                        <p>PSF計算に失敗しました。以下を確認してください:</p>
                        </ul>
                        <p>詳細なエラーはコンソールを確認してください。</p>
                    </div>
                `;
            }
            alert('PSF計算に失敗しました。光学系とオブジェクトの設定を確認してください。');
            return;
        }
        
            if (PSF_DEBUG) console.log('✅ PSF計算が正常に完了しました');
        
        // ローディングオーバーレイを非表示
        hidePSFLoadingOverlay();
        
        // PSF結果の構造を修正（PSFCalculatorの結果フォーマットに合わせる）
        if (psfResult && psfResult.psfData && !psfResult.psf) {
            psfResult.psf = psfResult.psfData;
        }
        
        console.log('📊 PSF結果の構造:', {
            hasResult: !!psfResult,
            keys: psfResult ? Object.keys(psfResult) : 'none',
            hasPSFData: psfResult ? !!psfResult.psfData : false,
            hasPSF: psfResult ? !!psfResult.psf : false,
            samplingSize: psfResult ? psfResult.samplingSize : 'none',
            psfType: psfResult?.psf ? (Array.isArray(psfResult.psf) ? 'array' : typeof psfResult.psf) : 'none',
            dimensions: psfResult?.psf && Array.isArray(psfResult.psf) ? `${psfResult.psf.length}x${psfResult.psf[0]?.length || 0}` : 'none',
            sampleValue: psfResult?.psf && Array.isArray(psfResult.psf) && psfResult.psf[0] ? psfResult.psf[0][0] : 'none',
            hasMetrics: psfResult ? !!psfResult.metrics : false,
            wavelength: psfResult ? psfResult.wavelength : 'none',
            debugMode: debugMode
        });        // PSF結果をグローバル変数に保存（チェックボックス機能用）
        window.lastPsfResult = psfResult;
        window.lastPsfResult.title = debugMode ? `Debug PSF - ${wavelength}nm (16×16)` : `PSF - ${wavelength}nm`;
        window.lastPsfObjectData = selectedObject;
        window.lastPsfWavelength = wavelength;
        window.lastPsfGridSize = psfSamplingSize;
        window.lastPsfDebugMode = debugMode;
        window.lastPsfError = null;

        // Persist token-light PSF summary for other windows / AI context
        try {
            const metrics = psfResult?.metrics || psfResult?.characteristics || null;
            const summary = {
                at: new Date().toISOString(),
                wavelength: psfResult?.wavelength ?? wavelength ?? null,
                gridSize: psfResult?.gridSize ?? psfSamplingSize ?? null,
                calculationTime: psfResult?.calculationTime ?? null,
                hasMetrics: !!metrics,
                metricKeys: metrics ? Object.keys(metrics).slice(0, 30) : [],
                // Lightweight PSF fingerprint (does not include full array)
                psfSummary: (psfResult && (psfResult.psfSummary || psfResult.summary)) ? (psfResult.psfSummary || psfResult.summary) : null,
                debugMode: !!debugMode,
            };
            localStorage.setItem('lastPsfMeta', JSON.stringify(summary));
            localStorage.removeItem('lastPsfError');
        } catch (_) {}
        
        // PSFプロット表示を呼び出し
        try {
            // チェックボックスの状態を取得
            const logScaleCheckbox = document.getElementById('psf-log-scale-checkbox') || 
                                    document.getElementById('psf-log-scale-cb');
            const logScaleEnabled = logScaleCheckbox?.checked || false;
            
            // eva-psf-plot.jsの表示関数を動的インポートして使用
            if (typeof window.displayPSFResult === 'function') {
                await window.displayPSFResult(psfResult, 'psf-container', {
                    plotType: '2D',
                    logScale: logScaleEnabled,
                    colorscale: 'BGR',
                    showMetrics: true
                });
            } else if (typeof window.displaySimplePSFResult === 'function') {
                window.displaySimplePSFResult(psfResult, 'psf-container');
            } else {
                // fallback: 従来の簡単表示
                const psfContainer = document.getElementById('psf-container');
                if (psfContainer) {
                    psfContainer.innerHTML = `
                        <div style="padding: 20px; text-align: center; color: #2e7d32; border: 1px solid #4caf50; border-radius: 5px; background-color: #e8f5e8;">
                            <h3>PSF計算完了</h3>
                            <p>オブジェクト${selectedObjectIndex + 1}のPSF計算が完了しました</p>
                            <p>波長: ${wavelength}μm</p>
                            <p>グリッドサイズ: ${psfSamplingSize}×${psfSamplingSize}</p>
                            <p>PSF配列サイズ: ${psfResult.psf ? psfResult.psf.length : 'unknown'}×${psfResult.psf && psfResult.psf[0] ? psfResult.psf[0].length : 'unknown'}</p>
                            <p>計算時間: ${psfResult.calculationTime || 'unknown'}ms</p>
                            <p style="color: #d32f2f;">⚠️ PSFプロット機能が読み込まれていません</p>
                        </div>
                    `;
                }
            }
        } catch (plotError) {
            console.error('❌ [PSF] プロット表示エラー:', plotError);
            
            // エラー時は従来の表示
            const psfContainer = document.getElementById('psf-container');
            if (psfContainer) {
                psfContainer.innerHTML = `
                    <div style="padding: 20px; text-align: center; color: #2e7d32; border: 1px solid #4caf50; border-radius: 5px; background-color: #e8f5e8;">
                        <h3>PSF計算完了</h3>
                        <p>オブジェクト${selectedObjectIndex + 1}のPSF計算が完了しました</p>
                        <p>波長: ${wavelength}μm</p>
                        <p>グリッドサイズ: ${psfSamplingSize}×${psfSamplingSize}</p>
                        <p>PSF配列サイズ: ${psfResult.psf ? psfResult.psf.length : 'unknown'}×${psfResult.psf && psfResult.psf[0] ? psfResult.psf[0].length : 'unknown'}</p>
                        <p>計算時間: ${psfResult.calculationTime || 'unknown'}ms</p>
                        <p style="color: #d32f2f;">プロット表示エラー: ${plotError.message}</p>
                    </div>
                `;
            }
        }
        
        console.log('✅ [PSF] PSF計算・表示完了');
    } catch (error) {
        if (error && (error.code === 'CANCELLED' || String(error.message || '').toLowerCase().includes('cancel'))) {
            console.warn('🟡 [PSF] Calculation cancelled:', error.message || error);
            try {
                hidePSFLoadingOverlay();
            } catch (_) {}
            return;
        }
        console.error('❌ [PSF] PSF計算処理エラー:', error);
        
        // ローディングオーバーレイを非表示
        hidePSFLoadingOverlay();
        
        const psfContainer = document.getElementById('psf-container');
        const rawMessage = String(error?.message || 'PSF calculation failed');
        const hintIdx = rawMessage.indexOf('hint=');
        const hint = hintIdx >= 0 ? rawMessage.slice(hintIdx + 'hint='.length).trim() : '';

        // Token-light global snapshot for debugging / AI context (no UX change)
        try {
            window.lastPsfError = {
                at: new Date().toISOString(),
                code: error?.code ?? null,
                message: rawMessage,
                rawMessage,
                hint,
                wavelength: wavelength ?? null,
                gridSize: psfSamplingSize ?? null,
                objectIndex: (typeof selectedObjectIndex === 'number') ? selectedObjectIndex : null,
                debugMode: debugMode ?? null
            };
        } catch (_) {}

        // Persist error snapshot for other windows / AI context
        try {
            localStorage.setItem('lastPsfError', JSON.stringify(window.lastPsfError));
        } catch (_) {}

        if (psfContainer) {
            const isWavefrontUnavailable = (error?.code === 'WAVEFRONT_UNAVAILABLE') || /stop unreachable|reference ray|chief ray|marginal ray/i.test(rawMessage);
            if (isWavefrontUnavailable) {
                psfContainer.innerHTML = `
                    <div style="padding: 16px; text-align: left; color: #b71c1c; border: 1px solid #d32f2f; border-radius: 6px; background-color: #ffebee;">
                        <h3 style="margin: 0 0 8px 0;">PSF計算不能</h3>
                        <div style="margin: 0 0 8px 0; color: #333;">このフィールドでは基準光線が作れず、PSF を定義できませんでした（ビネッティング/有効FOV外の可能性）。</div>
                        <pre style="margin: 0; white-space: pre-wrap; word-break: break-word; color: #b71c1c;">${rawMessage}</pre>
                        ${hint ? `<div style=\"margin-top: 10px; color: #333;\"><b>hint</b>: ${hint}</div>` : ''}
                        <div style="margin-top: 10px; color: #333;">フィールド角/高さを小さくして再試行してください。</div>
                    </div>
                `;
            } else {
                psfContainer.innerHTML = `
                    <div style="padding: 20px; text-align: center; color: #d32f2f; border: 1px solid #d32f2f; border-radius: 5px; background-color: #ffebee;">
                        <h3>PSF計算エラー</h3>
                        <p>PSF計算処理中にエラーが発生しました: ${rawMessage}</p>
                        <p>光学系とオブジェクトの設定を確認してください。</p>
                        <p>詳細なエラーはコンソールを確認してください。</p>
                    </div>
                `;
            }
        }

        // Avoid disruptive alerts for the expected “out-of-FOV / vignetted” failure mode.
        if (error?.code !== 'WAVEFRONT_UNAVAILABLE') {
            alert(`PSF計算エラー: ${rawMessage}`);
        }
    }
    finally {
        try {
            if (window.__psfActiveCancelToken === cancelToken) window.__psfActiveCancelToken = null;
            const stopBtn = document.getElementById('stop-psf-btn');
            if (stopBtn) stopBtn.disabled = true;
        } catch (_) {}
    }
}

/**
 * PSF表示設定のイベントリスナーを設定
 */
function setupPSFDisplaySettings() {
    // チェックボックスの要素を取得（IDを統一）
    const psfLogScaleCb = document.getElementById('psf-log-scale-checkbox') || 
                         document.getElementById('psf-log-scale-cb');
    const psfContoursCb = document.getElementById('psf-contours-cb');
    const psfCharacteristicsCb = document.getElementById('psf-characteristics-cb');
    
    function updatePSFDisplay() {
        console.log('🔄 [PSF] Updating PSF display with new settings');
        
        // ローディングオーバーレイを非表示（念のため）
        hidePSFLoadingOverlay();
        
        if (window.lastPsfResult) {
            // チェックボックスの状態を取得（IDを統一）
            const logScaleCheckbox = document.getElementById('psf-log-scale-checkbox') || 
                                    document.getElementById('psf-log-scale-cb');
            const logScaleEnabled = logScaleCheckbox?.checked || false;
            
            console.log('🔄 [PSF] ログスケール設定:', logScaleEnabled);
            
            // 新しいPSF表示システムを使用
            if (typeof window.displayPSFResult === 'function') {
                window.displayPSFResult(window.lastPsfResult, 'psf-container', {
                    plotType: '2D',
                    logScale: logScaleEnabled,
                    colorscale: 'BGR',
                    showMetrics: true
                }).catch(error => {
                    console.error('❌ [PSF] 表示更新エラー:', error);
                });
            } else {
                console.warn('⚠️ [PSF] displayPSFResult関数が利用できません');
            }
            const contoursEnabled = psfContoursCb?.checked || false;
            const characteristicsEnabled = psfCharacteristicsCb?.checked || true;
            
            console.log('🎛️ [PSF] Display settings:', {
                logScale: logScaleEnabled,
                contours: contoursEnabled,
                characteristics: characteristicsEnabled
            });
            
            // 現在のアクティブな表示モードを判定
            const activeButton = document.querySelector('.psf-display-btn.active');
            const plotlyContainer = document.getElementById('psf-plotly-container');
            const isPlotlyMode = plotlyContainer && plotlyContainer.style.display !== 'none';
            
            if (isPlotlyMode && activeButton) {
                // Plot.lyモードの場合は対応する関数を呼び出し
                const psfData = {
                    data: window.lastPsfResult.psf,
                    gridSize: window.lastPsfResult.gridSize,
                    characteristics: window.lastPsfResult.characteristics,
                    imageScale: window.lastPsfResult.imageScale  // 重要：imageScaleを追加
                };
                
                const options = {
                    logScale: logScaleEnabled,
                    contours: contoursEnabled,
                    characteristics: characteristicsEnabled
                };
                
                const buttonId = activeButton.id;
                switch (buttonId) {
                    case 'psf-2d-btn':
                        if (window.PSFPlotter) {
                            const plotter = new window.PSFPlotter('psf-plotly-container');
                            const ch = psfData.characteristics;
                            const fwhmX = Number(ch?.fwhmX || 0);
                            const fwhmY = Number(ch?.fwhmY || 0);
                            const metrics = options.characteristics && ch ? {
                                strehlRatio: Number(ch.strehlRatio || 0),
                                fwhm: { x: fwhmX, y: fwhmY, average: (fwhmX + fwhmY) / 2 },
                                peakIntensity: Number(ch.peakIntensity || 0),
                                totalEnergy: Number(ch.totalEnergy || 0),
                                encircledEnergy: ch.encircledEnergy || []
                            } : null;
                            plotter.plot2DPSF({ psfData: psfData.data, metrics }, {
                                logScale: !!options.logScale,
                                colorscale: 'BGR',
                                showMetrics: !!options.characteristics,
                                title: 'Point Spread Function'
                            }).catch(e => {
                                console.error('❌ [PSF] 2D plot update error:', e);
                                if (typeof createPSFHeatmap === 'function') {
                                    createPSFHeatmap(psfData, options, 'psf-plotly-container');
                                }
                            });
                        } else if (typeof createPSFHeatmap === 'function') {
                            createPSFHeatmap(psfData, options, 'psf-plotly-container');
                        }
                        break;
                    case 'psf-3d-btn':
                        if (window.PSFPlotter) {
                            const plotter = new window.PSFPlotter('psf-plotly-container');
                            const ch = psfData.characteristics;
                            const fwhmX = Number(ch?.fwhmX || 0);
                            const fwhmY = Number(ch?.fwhmY || 0);
                            const metrics = options.characteristics && ch ? {
                                strehlRatio: Number(ch.strehlRatio || 0),
                                fwhm: { x: fwhmX, y: fwhmY, average: (fwhmX + fwhmY) / 2 },
                                peakIntensity: Number(ch.peakIntensity || 0),
                                totalEnergy: Number(ch.totalEnergy || 0),
                                encircledEnergy: ch.encircledEnergy || []
                            } : null;
                            plotter.plot3DPSF({ psfData: psfData.data, metrics }, {
                                logScale: !!options.logScale,
                                colorscale: 'BGR',
                                showMetrics: !!options.characteristics,
                                title: 'Point Spread Function'
                            }).catch(e => {
                                console.error('❌ [PSF] 3D plot update error:', e);
                                if (typeof createPSF3DSurface === 'function') {
                                    createPSF3DSurface(psfData, options, 'psf-plotly-container');
                                }
                            });
                        } else if (typeof createPSF3DSurface === 'function') {
                            createPSF3DSurface(psfData, options, 'psf-plotly-container');
                        }
                        break;
                    case 'psf-profile-btn':
                        createPSFProfile(psfData, options, 'psf-plotly-container');
                        break;
                    case 'psf-energy-btn':
                        createEncircledEnergyPlot(psfData, options, 'psf-plotly-container');
                        break;
                    case 'wavefront-btn':
                        // 波面収差モードの場合は、設定変更では再計算しない
                        console.log('🌊 [Wavefront] Settings changed, but wavefront display requires recalculation');
                        break;
                    default:
                        break;
                }
            } else {
                // 従来のcanvas描画モード
                if (canvas) {
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    
                    // 最適化された高速描画を使用
                    plotPSF2DFast('psf-canvas', window.lastPsfResult, {
                        logScale: logScaleEnabled,
                        showContours: contoursEnabled,
                        showCrosshair: false,
                        showCharacteristics: characteristicsEnabled,
                        title: window.lastPsfResult.title || 'PSF',
                        showColorBar: true
                    });
                }
            }
            
            // 計算時間とその他の情報を更新 - disabled to hide PSF characteristics
            // updatePSFInfo(window.lastPsfResult, window.lastPsfObjectData, window.lastPsfWavelength, window.lastPsfGridSize);
        } else {
            console.warn('⚠️ [PSF] No PSF result available for display update');
        }
    }
    
    if (psfLogScaleCb) {
        psfLogScaleCb.addEventListener('change', updatePSFDisplay);
        console.log('✅ [PSF] Log scale checkbox listener added');
    }
    if (psfContoursCb) {
        psfContoursCb.addEventListener('change', updatePSFDisplay);
        console.log('✅ [PSF] Contours checkbox listener added');
    }
    if (psfCharacteristicsCb) {
        psfCharacteristicsCb.addEventListener('change', updatePSFDisplay);
        console.log('✅ [PSF] Characteristics checkbox listener added');
    }
}

/**
 * PSF情報パネルを更新
 */
export function updatePSFInfo(psfResult, objectData, wavelength, gridSize) {
    console.log('📊 [PSF] PSF info panel is disabled - not displaying characteristics');
    
    // PSF info panel is disabled - hide it
    const psfInfoPanel = document.getElementById('psf-info');
    if (psfInfoPanel) {
        psfInfoPanel.style.display = 'none';
    }
}

/**
 * テーブル変更イベントリスナーを設定
 */
function setupTableChangeListeners() {
    // Guard against duplicate Tabulator .on registrations.
    if (window.__tableChangeListenersBound) return;
    window.__tableChangeListenersBound = true;

    // 面選択の初期更新
    setTimeout(updateSurfaceNumberSelectLegacy, 1500);
    
    // 光学系テーブル変更時に面選択を更新
    if (window.opticalSystemTabulator && typeof window.opticalSystemTabulator.on === 'function') {
        window.opticalSystemTabulator.on('dataChanged', updateSurfaceNumberSelectLegacy);
        window.opticalSystemTabulator.on('rowAdded', updateSurfaceNumberSelectLegacy);
        window.opticalSystemTabulator.on('rowDeleted', updateSurfaceNumberSelectLegacy);
    } else {
        console.warn('⚠️ opticalSystemTabulator is not initialized or does not have .on method');
    }
    
    // PSF関連の機能は削除されました
    if (window.objectTabulator && typeof window.objectTabulator.on === 'function') {
        console.log('✅ Object table listeners ready');
    } else {
        console.warn('⚠️ objectTabulator is not initialized or does not have .on method');
    }
    
    // tableObjectが利用可能な場合の確認
    if (window.tableObject && typeof window.tableObject.on === 'function') {
        console.log('✅ tableObject listeners ready');
    }
}

/**
 * テーブルの初期化を待つ関数
 */
function waitForTableInitialization() {
    // Cache: multiple callers should share one waiter to avoid duplicated timers/logs.
    if (window.__tableInitReady) return Promise.resolve();
    if (window.__tableInitPromise) return window.__tableInitPromise;

    window.__tableInitPromise = new Promise((resolve) => {
        const checkInterval = setInterval(() => {
            if (window.tableOpticalSystem && 
                typeof window.tableOpticalSystem.on === 'function' &&
                window.tableObject && 
                typeof window.tableObject.on === 'function') {
                clearInterval(checkInterval);
                console.log('✅ All tables are initialized');
                window.__tableInitReady = true;
                resolve();
            }
        }, 100); // 100ms間隔でチェック
        
        // 5秒後にタイムアウト
        setTimeout(() => {
            clearInterval(checkInterval);
            if (!window.__tableInitReady) {
                console.warn('⚠️ Table initialization timeout');
            }
            resolve();
        }, 5000);
    });

    return window.__tableInitPromise;
}

/**
 * PSFの初期化を試行
 */
function tryInitializePSF() {
    let initAttempts = 0;
    const maxAttempts = 10;
    
    function attemptInitialization() {
        initAttempts++;
        console.log(`🕒 PSF初期化試行 ${initAttempts}/${maxAttempts}`);
        
        const objectRows = getObjectRows();
        if (objectRows && objectRows.length > 0) {
            console.log('✅ オブジェクトデータが見つかりました');
            // PSF機能は削除されました
        } else if (initAttempts < maxAttempts) {
            console.log('⏳ オブジェクトデータの準備ができていません、200ms後に再試行...');
            setTimeout(attemptInitialization, 200);
        } else {
            console.warn('⚠️ 最大試行回数後に初期化が完了しませんでした');
            // PSF機能は削除されました
        }
    }
    
    // 初期化試行を開始
    setTimeout(attemptInitialization, 100);
    
    // PSF機能は削除されました
}

/**
 * PSF表示モード切り替えボタンのイベントハンドラーを設定
 */
function setupPSFDisplayModeButtons() {
    const psf2DBtn = document.getElementById('psf-2d-btn');
    const psf3DBtn = document.getElementById('psf-3d-btn');
    const psfProfileBtn = document.getElementById('psf-profile-btn');
    const psfEnergyBtn = document.getElementById('psf-energy-btn');
    const wavefrontBtn = document.getElementById('wavefront-btn');
    
    const canvas = document.getElementById('psf-canvas');
    
    // Plot.lyコンテナの存在確認と作成
    function ensurePlotlyContainer() {
        let plotlyContainer = document.getElementById('psf-plotly-container');
        if (!plotlyContainer) {
            console.log('⚠️ [PSF] Creating missing Plot.ly container');
            const psfContainer = document.getElementById('psf-container');
            if (psfContainer) {
                plotlyContainer = document.createElement('div');
                plotlyContainer.id = 'psf-plotly-container';
                plotlyContainer.style.cssText = `
                    width: 600px;
                    height: 600px;
                    border: 1px solid #ddd;
                    background-color: #f8f9fa;
                    border-radius: 4px;
                    margin: 10px auto;
                `;
                psfContainer.appendChild(plotlyContainer);
            }
        }
        return plotlyContainer;
    }
    
    // 現在のアクティブボタンを管理
    let currentActiveBtn = psf2DBtn;
    
    function setActiveButton(btn) {
        // 全ボタンからactiveクラスを削除
        [psf2DBtn, psf3DBtn, psfProfileBtn, psfEnergyBtn, wavefrontBtn].forEach(b => {
            if (b) b.classList.remove('active');
        });
        
        // 選択されたボタンにactiveクラスを追加
        if (btn) {
            btn.classList.add('active');
            currentActiveBtn = btn;
        }
    }
    
    function getPSFDisplayOptions() {
        const logScaleCb = document.getElementById('psf-log-scale-cb');
        const contoursCb = document.getElementById('psf-contours-cb');
        const characteristicsCb = document.getElementById('psf-characteristics-cb');
        
        return {
            logScale: logScaleCb?.checked || false,
            contours: contoursCb?.checked || false,
            characteristics: characteristicsCb?.checked || false
        };
    }

    function characteristicsToMetrics(characteristics) {
        if (!characteristics) return null;
        const fwhmX = Number(characteristics.fwhmX || 0);
        const fwhmY = Number(characteristics.fwhmY || 0);
        return {
            strehlRatio: Number(characteristics.strehlRatio || 0),
            fwhm: {
                x: fwhmX,
                y: fwhmY,
                average: (fwhmX + fwhmY) / 2
            },
            peakIntensity: Number(characteristics.peakIntensity || 0),
            totalEnergy: Number(characteristics.totalEnergy || 0),
            encircledEnergy: characteristics.encircledEnergy || []
        };
    }

    async function renderPSFWithNewPlotter(kind, psfData, options, containerId) {
        if (!window.PSFPlotter) return false;

        const plotter = new window.PSFPlotter(containerId);
        const psfResultForPlotter = {
            psfData: psfData.data,
            metrics: options.characteristics ? characteristicsToMetrics(psfData.characteristics) : null
        };

        if (kind === '2D') {
            await plotter.plot2DPSF(psfResultForPlotter, {
                logScale: !!options.logScale,
                colorscale: 'BGR',
                showMetrics: !!options.characteristics,
                title: 'Point Spread Function'
            });
            return true;
        }

        if (kind === '3D') {
            await plotter.plot3DPSF(psfResultForPlotter, {
                logScale: !!options.logScale,
                colorscale: 'BGR',
                showMetrics: !!options.characteristics,
                title: 'Point Spread Function'
            });
            return true;
        }

        return false;
    }
    
    // 2D Heatmapボタン
    if (psf2DBtn) {
        psf2DBtn.addEventListener('click', async () => {
            console.log('📊 2D Heatmap button clicked');
            
            // ローディングオーバーレイを非表示（念のため）
            hidePSFLoadingOverlay();
            
            if (window.lastPsfResult) {
                setActiveButton(psf2DBtn);
                
                // Ensure Plot.ly container exists
                const plotlyContainer = ensurePlotlyContainer();
                
                // Hide canvas, show Plot.ly
                if (canvas) canvas.style.display = 'none';
                if (plotlyContainer) plotlyContainer.style.display = 'block';
                
                // Convert data format
                const psfData = {
                    data: window.lastPsfResult.psf,
                    gridSize: window.lastPsfResult.gridSize,
                    characteristics: window.lastPsfResult.characteristics,
                    imageScale: window.lastPsfResult.imageScale  // 重要：imageScaleを追加
                };
                
                const options = getPSFDisplayOptions();
                try {
                    const ok = await renderPSFWithNewPlotter('2D', psfData, options, 'psf-plotly-container');
                    if (!ok && typeof createPSFHeatmap === 'function') {
                        createPSFHeatmap(psfData, options, 'psf-plotly-container');
                    }
                } catch (e) {
                    console.error('❌ [PSF] 2D plot error:', e);
                    if (typeof createPSFHeatmap === 'function') {
                        createPSFHeatmap(psfData, options, 'psf-plotly-container');
                    }
                }
            } else {
                alert('PSFを計算してください。');
            }
        });
    }
    
    // 3D Surface button
    if (psf3DBtn) {
        psf3DBtn.addEventListener('click', async () => {
            console.log('📊 3D Surface button clicked');
            
            // ローディングオーバーレイを非表示（念のため）
            hidePSFLoadingOverlay();
            
            if (window.lastPsfResult) {
                setActiveButton(psf3DBtn);
                
                // Ensure Plot.ly container exists
                const plotlyContainer = ensurePlotlyContainer();
                
                // Hide canvas, show Plot.ly
                if (canvas) canvas.style.display = 'none';
                if (plotlyContainer) plotlyContainer.style.display = 'block';
                
                // Convert data format
                const psfData = {
                    data: window.lastPsfResult.psf,
                    gridSize: window.lastPsfResult.gridSize,
                    characteristics: window.lastPsfResult.characteristics,
                    imageScale: window.lastPsfResult.imageScale  // 重要：imageScaleを追加
                };
                
                const options = getPSFDisplayOptions();
                try {
                    const ok = await renderPSFWithNewPlotter('3D', psfData, options, 'psf-plotly-container');
                    if (!ok && typeof createPSF3DSurface === 'function') {
                        createPSF3DSurface(psfData, options, 'psf-plotly-container');
                    }
                } catch (e) {
                    console.error('❌ [PSF] 3D plot error:', e);
                    if (typeof createPSF3DSurface === 'function') {
                        createPSF3DSurface(psfData, options, 'psf-plotly-container');
                    }
                }
            } else {
                alert('PSFを計算してください。');
            }
        });
    }
    
    // Profile button
    if (psfProfileBtn) {
        psfProfileBtn.addEventListener('click', () => {
            console.log('📊 Profile button clicked');
            
            // ローディングオーバーレイを非表示（念のため）
            hidePSFLoadingOverlay();
            
            if (window.lastPsfResult) {
                setActiveButton(psfProfileBtn);
                
                // Ensure Plot.ly container exists
                const plotlyContainer = ensurePlotlyContainer();
                
                // Hide canvas, show Plot.ly
                if (canvas) canvas.style.display = 'none';
                if (plotlyContainer) plotlyContainer.style.display = 'block';
                
                // Convert data format
                const psfData = {
                    data: window.lastPsfResult.psf,
                    gridSize: window.lastPsfResult.gridSize,
                    characteristics: window.lastPsfResult.characteristics,
                    imageScale: window.lastPsfResult.imageScale  // 重要：imageScaleを追加
                };
                
                const options = getPSFDisplayOptions();
                createPSFProfile(psfData, options, 'psf-plotly-container');
            } else {
                alert('PSFを計算してください。');
            }
        });
    }
    
    // Encircled Energy button
    if (psfEnergyBtn) {
        psfEnergyBtn.addEventListener('click', () => {
            console.log('📊 Encircled Energy button clicked');
            
            // ローディングオーバーレイを非表示（念のため）
            hidePSFLoadingOverlay();
            
            if (window.lastPsfResult) {
                setActiveButton(psfEnergyBtn);
                
                // Ensure Plot.ly container exists
                const plotlyContainer = ensurePlotlyContainer();
                
                // Hide canvas, show Plot.ly
                if (canvas) canvas.style.display = 'none';
                if (plotlyContainer) plotlyContainer.style.display = 'block';
                
                // Convert data format
                const psfData = {
                    data: window.lastPsfResult.psf,
                    gridSize: window.lastPsfResult.gridSize,
                    characteristics: window.lastPsfResult.characteristics,
                    imageScale: window.lastPsfResult.imageScale  // 重要：imageScaleを追加
                };
                
                const options = getPSFDisplayOptions();
                createEncircledEnergyPlot(psfData, options, 'psf-plotly-container');
            } else {
                alert('PSFを計算してください。');
            }
        });
    }
    
    // Wavefront button
    if (wavefrontBtn) {
        wavefrontBtn.addEventListener('click', async () => {
            console.log('🌊 Wavefront button clicked');
            
            // ローディングオーバーレイを非表示（念のため）
            hidePSFLoadingOverlay();
            
            // PSF結果の代わりに、オブジェクトデータから直接波面収差を計算
            const psfObjectSelect = document.getElementById('psf-object-select');
            if (!psfObjectSelect || !psfObjectSelect.value) {
                alert('波面収差表示のためのオブジェクトを選択してください');
                return;
            }
            
            const selectedObjectIndex = parseInt(psfObjectSelect.value);
            const objectRows = getObjectRows();
            const opticalSystemRows = getOpticalSystemRows();
            
            if (!objectRows || selectedObjectIndex >= objectRows.length) {
                alert('選択されたオブジェクトが無効です');
                return;
            }
            
            if (!opticalSystemRows || opticalSystemRows.length === 0) {
                alert('光学系データが見つかりません');
                return;
            }
            
            const selectedObject = objectRows[selectedObjectIndex];
            const wavelengthSelect = document.getElementById('psf-wavelength-select');
            const gridSizeSelect = document.getElementById('psf-grid-size-select');
            const wavelength = wavelengthSelect ? parseFloat(wavelengthSelect.value) : 0.5876;
            const gridSize = gridSizeSelect ? parseInt(gridSizeSelect.value) : 64;
            
            try {
                setActiveButton(wavefrontBtn);
                
                // Show loading overlay
                showPSFLoadingOverlay(gridSize, wavelength.toString(), false);
                
                // Create field setting from object
                const fieldSetting = createFieldSettingFromObject(selectedObject);
                if (!fieldSetting) {
                    alert('選択されたオブジェクトからフィールド設定の作成に失敗しました');
                    return;
                }
                
                // Calculate wavefront aberration
                console.log('🌊 [Wavefront] Calculating wavefront aberration...');
                const wavefrontData = await calculateWavefrontAberration(opticalSystemRows, fieldSetting, wavelength, {
                    gridSize: gridSize,
                    debugMode: false
                });
                
                // Hide loading overlay
                hidePSFLoadingOverlay();
                
                // Ensure Plot.ly container exists
                const plotlyContainer = ensurePlotlyContainer();
                
                // Hide canvas, show Plot.ly
                if (canvas) canvas.style.display = 'none';
                if (plotlyContainer) plotlyContainer.style.display = 'block';
                
                // Get display options
                const options = {
                    showStatistics: document.getElementById('psf-characteristics-cb')?.checked || true,
                    contours: document.getElementById('psf-contours-cb')?.checked || false
                };
                
                // Create wavefront heatmap
                await createWavefrontHeatmap(wavefrontData, options, 'psf-plotly-container');
                
                console.log('✅ [Wavefront] Wavefront visualization completed');
                
            } catch (error) {
                console.error('❌ [Wavefront] Error displaying wavefront:', error);
                hidePSFLoadingOverlay();
                alert(`波面収差表示エラー: ${error.message}`);
            }
        });
    }
}

function setupExpandedOpticalSystemToggle() {
    try {
        const btn = document.getElementById('toggle-expanded-optical-system-btn');
        const content = document.getElementById('expanded-optical-system-content');
        if (!btn || !content) return;

        const isCollapsed = () => {
            try {
                if (content.style.display === 'none') return true;
                return (typeof getComputedStyle === 'function')
                    ? (getComputedStyle(content).display === 'none')
                    : false;
            } catch (_) {
                return content.style.display === 'none';
            }
        };

        const setCollapsed = (collapsed) => {
            content.style.display = collapsed ? 'none' : '';
            btn.textContent = collapsed ? 'Expand' : 'Collapse';
            btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        };

        // Default: expanded
        setCollapsed(false);

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            setCollapsed(!isCollapsed());
        });
    } catch (e) {
        console.warn('⚠️ Failed to setup Expanded Optical System toggle:', e);
    }
}

/**
 * PSF計算用のローディングオーバーレイを表示
 */
function showPSFLoadingOverlay(gridSize, wavelength, debugMode = false) {
    const psfContainer = document.getElementById('psf-container');
    let loadingOverlay = document.getElementById('psf-loading-overlay');
    
    if (loadingOverlay) {
        loadingOverlay.remove();
    }
    
    loadingOverlay = document.createElement('div');
    loadingOverlay.id = 'psf-loading-overlay';
    loadingOverlay.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(255, 255, 255, 0.9);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        border-radius: 5px;
    `;
    
    const modeText = debugMode ? '🔧 デバッグモードでPSFを計算中...' : '🔬 WASM高速化でPSFを計算中...';
    const additionalInfo = debugMode ? '<p>🔍 最大16本の光線追跡詳細ログを出力中...</p>' : '';
    
    loadingOverlay.innerHTML = `
        <div class="psf-spinner" style="width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px;"></div>
        <p>${modeText}</p>
        <p>グリッドサイズ: ${gridSize}×${gridSize}</p>
        <p>波長: ${wavelength} ${wavelength === 'polychromatic' ? '' : 'μm'}</p>
        ${additionalInfo}
        <style>
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        </style>
    `;
    
    if (psfContainer) {
        psfContainer.style.position = 'relative';
        psfContainer.appendChild(loadingOverlay);
    }
    
    console.log('✅ PSF loading overlay shown');
}

/**
 * PSF計算用のローディングオーバーレイを非表示
 */
function hidePSFLoadingOverlay() {
    const loadingOverlay = document.getElementById('psf-loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.remove();
        console.log('✅ PSF loading overlay hidden');
    }
}

/**
 * すべてのDOMイベントハンドラーを設定（メイン関数）
 */
export function setupDOMEventHandlers() {
    // Guard: avoid registering the same UI/table listeners multiple times.
    // Some load flows can call this more than once.
    if (window.__domEventHandlersInitialized) {
        console.log('ℹ️ DOM event handlers already initialized; skipping re-bind');
        return;
    }
    window.__domEventHandlersInitialized = true;

    console.log('🎯 DOM Content Loaded - イベントリスナーを設定中...');
    
    // WASMテストボタンのハンドラーを設定
    const wasmTestBtn = document.getElementById('debug-wasm-system');
    if (wasmTestBtn) {
        wasmTestBtn.addEventListener('click', function() {
            console.log('🔥 WASM System Test initiated...');
            debugWASMSystem();
            setTimeout(() => quickWASMComparison(), 1000);
        });
        console.log('✅ WASM test button handler set up');
    } else {
        console.warn('⚠️ WASM test button not found');
    }
    
    // グローバルアクセス用にテーブルオブジェクトを設定
    // 可能ならモジュール側のTabulatorインスタンスを優先してwindowへバインド
    window.tableSource = window.tableSource || tableSource;
    window.tableObject = window.tableObject || tableObject;
    window.tableOpticalSystem = window.tableOpticalSystem || tableOpticalSystem;
    // 互換性のための別名
    window.objectTabulator = window.objectTabulator || window.tableObject;
    window.opticalSystemTabulator = window.opticalSystemTabulator || window.tableOpticalSystem;
    console.log('✅ テーブルがwindowオブジェクトに設定されました');
    
    // テーブルの初期化状況を確認
    console.log('🔍 テーブル初期化状況:');
    console.log('- window.tableOpticalSystem:', !!window.tableOpticalSystem);
    console.log('- window.opticalSystemTabulator:', !!window.opticalSystemTabulator);
    console.log('- window.tableObject:', !!window.tableObject);
    console.log('- window.objectTabulator:', !!window.objectTabulator);
    
    if (window.opticalSystemTabulator && typeof window.opticalSystemTabulator.on === 'function') {
        console.log('✅ opticalSystemTabulator.on method is available');
    } else {
        console.warn('⚠️ opticalSystemTabulator.on method is not available');
        console.log('   - opticalSystemTabulator type:', typeof window.opticalSystemTabulator);
        console.log('   - opticalSystemTabulator.on type:', typeof window.opticalSystemTabulator?.on);
    }
    
    // 関数が利用可能かどうかを確認
    console.log('🔍 関数の利用可能性をチェック:');
    console.log('- outputParaxialDataToDebug:', typeof outputParaxialDataToDebug);
    console.log('- displayCoordinateTransformMatrix:', typeof displayCoordinateTransformMatrix);
    console.log('- window.outputParaxialDataToDebug:', typeof window.outputParaxialDataToDebug);
    console.log('- window.displayCoordinateTransformMatrix:', typeof window.displayCoordinateTransformMatrix);
    
    try {
        // UIイベントハンドラーを設定
        setupSaveButton();
        setupLoadButton();
        setupClearStorageButton();
        setupSuggestOptimizeButtons();
        setupApplyToDesignIntentButton();
        setupParaxialButton();
        setupSeidelButton();
        setupSeidelAfocalButton();
        setupCoordinateTransformButton();
        setupSpotDiagramConfigSelect();
        setupSpotDiagramButton();
        setupLongitudinalAberrationButton();
        setupTransverseAberrationButton();
        setupDistortionButton();
        setupIntegratedAberrationButton();
        setupAstigmatismButton();
        setupWavefrontAberrationButton();
        setupPSFCalculationButton();
        setupDebugPSFCalculationButton();
        setupPSFDisplaySettings();
        setupExpandedOpticalSystemToggle();
        setupPSFDisplayModeButtons();

        // System Requirements summary (BFL etc.) is rendered from surface rows; no user input here.
        
        // 初期化後にObject選択オプションを更新
        updateWavefrontObjectOptions();
        setupPSFObjectSelect();
        
        // PSFオブジェクト選択肢の定期更新（テーブルデータ変更を検知）
        // UI初期化が複数回走ると setInterval が多重登録されてログ/負荷が増えるため、window に1つだけ保持する
        if (!window.__psfObjectOptionsIntervalId) {
            window.__psfObjectOptionsIntervalId = setInterval(() => {
                if (typeof updatePSFObjectOptions === 'function') {
                    updatePSFObjectOptions();
                }
            }, 10000); // 10秒ごとに更新（頻度を下げてユーザーの選択を保護）
        }
        
        // テーブルの初期化を待ってからリスナーを設定
        waitForTableInitialization().then(() => {
            setupTableChangeListeners();
        });
        setupPSFDisplayModeButtons(); // PSF表示モード切り替えボタンのセットアップ
        
        console.log('✅ UIイベントハンドラーが正常に設定されました');
    } catch (error) {
        console.error('❌ UIイベントハンドラー設定エラー:', error);
    }

    try { refreshBlockInspector(); } catch (_) {}
    
    // PSF初期化を試行
    tryInitializePSF();
    
    // テーブル初期化待機
    waitForTableInitialization().then(() => {
        console.log('✅ テーブル初期化完了');
        
        // PSF設定のイベントリスナーを遅延設定（DOM要素が確実に存在するように）
        setTimeout(() => {
            setupPSFDisplaySettings();
            setupPSFObjectSelect(); // PSFオブジェクト選択も遅延初期化
        }, 1000);
        
        // さらに遅延してPSFオブジェクト選択を再設定（テーブルデータが確実に読み込まれた後）
        setTimeout(() => {
            if (globalThis.__PSF_DEBUG) console.log('🔄 [PSF] 遅延PSFオブジェクト選択設定');
            setupPSFObjectSelect();
        }, 2000);
    }).catch(err => {
        console.error('❌ テーブル初期化エラー:', err);
    });
    
    // プロットパフォーマンステストUIを初期化 (disabled)
    // setTimeout(() => {
    //     createPlotPerformanceTestButton();
    // }, 500);
}

/**
 * PSF図表示メイン関数
 * @param {string} plotType - プロットタイプ ('2d', '3d', 'encircled')
 * @param {number} samplingSize - サンプリングサイズ (32, 64, 128, 256)
 * @param {boolean} logScale - ログスケール
 * @param {number} objectIndex - オブジェクトインデックス
 */
async function showPSFDiagram(plotType, samplingSize, logScale, objectIndex, options = {}) {
    try {
        const cancelToken = (options && options.cancelToken) ? options.cancelToken : null;
        throwIfCancelled(cancelToken);
        const PSF_DEBUG = !!(typeof globalThis !== 'undefined' && globalThis.__PSF_DEBUG);
        if (PSF_DEBUG) console.log('🔬 [PSF] PSF計算・表示開始');

        const getActiveConfigLabel = () => {
            try {
                if (typeof localStorage === 'undefined') return '';
                const raw = localStorage.getItem('systemConfigurations');
                if (!raw) return '';
                const sys = JSON.parse(raw);
                const activeId = sys?.activeConfigId;
                const cfg = Array.isArray(sys?.configurations)
                    ? sys.configurations.find(c => String(c?.id) === String(activeId))
                    : null;
                if (!cfg) return activeId !== undefined && activeId !== null ? `id=${activeId}` : '';
                return `id=${cfg.id} name=${cfg.name || ''}`.trim();
            } catch (_) {
                return '';
            }
        };

        const externalOnProgress = (options && typeof options.onProgress === 'function') ? options.onProgress : null;
        const emitProgress = (percent, phase, message) => {
            if (!externalOnProgress) return;
            try {
                const p = Number(percent);
                externalOnProgress({
                    percent: Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : null,
                    phase: phase || null,
                    message: message || null
                });
            } catch (_) {
                // ignore
            }
        };

        const calcFNV1a32 = (str) => {
            let hash = 0x811c9dc5;
            for (let i = 0; i < str.length; i++) {
                hash ^= str.charCodeAt(i);
                hash = Math.imul(hash, 0x01000193);
            }
            return (hash >>> 0).toString(16);
        };

        const summarizeOpticalSystemRows = (rows) => {
            if (!Array.isArray(rows) || rows.length === 0) return { checksum: '0', first: null, last: null };
            const parts = [];
            for (const r of rows) {
                if (!r) continue;
                const obj = r['object type'] ?? r.object ?? r.Object ?? '';
                const radius = r.radius ?? r.Radius ?? '';
                const thickness = r.thickness ?? r.Thickness ?? '';
                const material = r.material ?? r.Material ?? '';
                const semidia = r.semidia ?? r.semidiameter ?? r.SemiDia ?? '';
                const id = r.id ?? '';
                parts.push(`${id}|${obj}|${radius}|${thickness}|${material}|${semidia}`);
            }
            const joined = parts.join(';');
            return {
                checksum: calcFNV1a32(joined),
                first: parts[0] || null,
                last: parts[parts.length - 1] || null
            };
        };
        
        // 必要なモジュールを動的インポート
        // PSFCalculator はシングルトンで再利用（WASM初期化を使い回す）
        const { PSFPlotter } = await import('../eva-psf-plot.js');
        const { createOPDCalculator } = await import('../eva-wavefront.js');
        
        // 光学システムデータを取得（live table を優先）
        const opticalSystemRows = getOpticalSystemRows(window.tableOpticalSystem);
        if (!opticalSystemRows || opticalSystemRows.length === 0) {
            throw new Error('光学システムデータがありません。まず光学システムを設定してください。');
        }

        const opticalSystemSource = (window.tableOpticalSystem && typeof window.tableOpticalSystem.getData === 'function')
            ? 'table'
            : (typeof localStorage !== 'undefined' && !!localStorage.getItem('OpticalSystemTableData'))
                ? 'localStorage'
                : 'dummy';

        const opticalSystemSummary = summarizeOpticalSystemRows(opticalSystemRows);

        // Always emit a compact identity line so it's obvious which config/data PSF used.
        try {
            const idx4 = opticalSystemRows?.[4];
            const idx5 = opticalSystemRows?.[5];
            console.log(
                `🧾 [PSF] activeConfig=${getActiveConfigLabel() || '(none)'} source=${opticalSystemSource} rows=${opticalSystemRows.length} checksum=${opticalSystemSummary.checksum}` +
                ` idx4(th=${idx4?.thickness}) idx5(th=${idx5?.thickness})`
            );
        } catch (_) {}
        
        // Objectデータを取得（live table を優先）
        const objects = getObjectRows(window.tableObject);
        if (!objects || objects.length === 0) {
            throw new Error('オブジェクトデータがありません。まずオブジェクトを設定してください。');
        }
        
        if (objectIndex >= objects.length) {
            throw new Error('指定されたオブジェクトが見つかりません。');
        }
        
        if (PSF_DEBUG) {
            console.log(`🔍 [PSF] showPSFDiagram - objectIndex: ${objectIndex}, objects.length: ${objects.length}`);
            console.log(`🔍 [PSF] Available objects:`, objects.map((obj, idx) => ({ 
                index: idx, 
                x: obj.x || obj.xHeightAngle || 0, 
                y: obj.y || obj.yHeightAngle || 0 
            })));
        }
        
        const selectedObject = objects[objectIndex];
        if (PSF_DEBUG) {
            console.log(`🔍 [PSF] Selected object:`, {
                index: objectIndex,
                object: selectedObject,
                x: selectedObject.x || selectedObject.xHeightAngle || 0,
                y: selectedObject.y || selectedObject.yHeightAngle || 0
            });
        }
        
        // 光源データから波長を取得
        const sources = getSourceRows(window.tableSource);
        // Sourceテーブルの主波長を優先
        const wavelength = (typeof window !== 'undefined' && typeof window.getPrimaryWavelength === 'function')
            ? (Number(window.getPrimaryWavelength()) || 0.5876)
            : ((sources && sources.length > 0) ? (sources[0].wavelength || 0.5876) : 0.5876);
        
        // PSF performance mode (auto/wasm/javascript)
        // - popup can override via options.forceImplementation without touching main UI
        const performanceSelect = document.getElementById('psf-performance-select');
        const selectedMode = performanceSelect ? performanceSelect.value : 'auto';
        const forcedModeRaw = options && Object.prototype.hasOwnProperty.call(options, 'forceImplementation')
            ? options.forceImplementation
            : undefined;
        const forcedMode = (forcedModeRaw === 'wasm' || forcedModeRaw === 'javascript' || forcedModeRaw === 'auto' || forcedModeRaw === null)
            ? forcedModeRaw
            : undefined;
        const performanceMode = forcedMode !== undefined ? forcedMode : selectedMode;

        // OPDデータを計算
        // PSF入力のOPDは「Zernikeでフィットした関数面」を直接サンプリングして作る
        if (PSF_DEBUG) console.log('📊 [PSF] Zernikeフィット面からOPD格子を生成中...');
        const { WavefrontAberrationAnalyzer } = await import('../eva-wavefront.js');
        const opdCalculator = createOPDCalculator(opticalSystemRows, wavelength);
        const analyzer = new WavefrontAberrationAnalyzer(opdCalculator);
        
        // フィールド設定（選択されたオブジェクトの座標を使用）
        // NOTE: 0 を falsy として扱わないために ?? を使用
        // Object tableのデータ形式に応じて角度または高さを設定
        const objectX = (selectedObject.x ?? selectedObject.xHeightAngle ?? 0);
        const objectY = (selectedObject.y ?? selectedObject.yHeightAngle ?? 0);
        
        // Object typeを確認（Angle / Height / Rectangle / Point ...）
        const objectTypeRaw = String(selectedObject.position ?? selectedObject.object ?? selectedObject.Object ?? selectedObject.objectType ?? 'Point');
        const objectType = objectTypeRaw;
        const objectTypeLower = objectTypeRaw.toLowerCase();

        let fieldAngle = { x: 0, y: 0 };
        let xHeight = 0;
        let yHeight = 0;

        // IMPORTANT: 'rectangle' contains the substring 'angle'.
        // Use a word-boundary test so Rectangle is not treated as Angle.
        if (/\bangle\b/.test(objectTypeLower)) {
            // Angle (deg): interpret as field angle. Solver selection is handled by eva-wavefront.js.
            fieldAngle = { x: Number(objectX) || 0, y: Number(objectY) || 0 };
            xHeight = 0;
            yHeight = 0;
        } else {
            // Point/Rectangle/Height 等は高さ扱い
            fieldAngle = { x: 0, y: 0 };
            xHeight = Number(objectX) || 0;
            yHeight = Number(objectY) || 0;
        }

        const fieldSetting = {
            objectIndex: objectIndex,
            type: objectType,
            fieldAngle,
            xHeight,
            yHeight,
            wavelength: wavelength
        };

        // Popup PSF window calls showPSFDiagram directly; emit a compact line regardless of __PSF_DEBUG.
        console.log(`🧭 [PSF] objectIndex=${objectIndex} type=${objectType} fieldAngle=(${fieldSetting.fieldAngle.x},${fieldSetting.fieldAngle.y}) height=(${fieldSetting.xHeight},${fieldSetting.yHeight}) wl=${wavelength}`);
        
        if (PSF_DEBUG) {
            console.log(`🔍 [PSF] Field setting created:`, fieldSetting);
            console.log(`🔍 [PSF] Object type: ${objectType}, coordinates: (${objectX}, ${objectY})`);
        }
        
        const psfSamplingSize = Number.isFinite(Number(samplingSize)) ? Math.max(16, Math.floor(Number(samplingSize))) : 64;
        // Zernikeフィット用サンプリング（未指定ならPSFと同じ）
        const zernikeSelect = document.getElementById('psf-zernike-sampling-select');
        const zernikeFitSamplingSize = (options && Number.isFinite(Number(options.zernikeFitSamplingSize)))
            ? Math.max(16, Math.floor(Number(options.zernikeFitSamplingSize)))
            : (zernikeSelect ? Math.max(16, Math.floor(Number(zernikeSelect.value))) : psfSamplingSize);

        emitProgress(0, 'wavefront', 'Wavefront start');
        const wavefrontMap = await analyzer.generateWavefrontMap(fieldSetting, zernikeFitSamplingSize, 'circular', {
            recordRays: false,
            progressEvery: 0,
            zernikeMaxNoll: 37,
            renderFromZernike: true,
            cancelToken,
            onProgress: (evt) => {
                const p = Number(evt?.percent);
                if (!Number.isFinite(p)) {
                    emitProgress(null, evt?.phase || 'wavefront', evt?.message || 'Wavefront...');
                    return;
                }
                // Map wavefront progress 0..100 => overall 0..80
                const overall = 0 + 0.8 * p;
                emitProgress(overall, evt?.phase || 'wavefront', evt?.message || `Wavefront ${Math.floor(p)}%`);
            }
        });

        throwIfCancelled(cancelToken);

        emitProgress(80, 'wavefront', 'Wavefront done');

        if (wavefrontMap?.error) {
            throw new Error(wavefrontMap.error?.message || 'Wavefront generation failed');
        }

        // NOTE: PSF入力格子は psfSamplingSize と同じ解像度で「Zernike面」を評価して作る（補間を避ける）。
        // PSFは通常、piston/tilt を除去した波面（chief ray 基準）で評価する。
        const zGrid = analyzer.generateZernikeRenderGrid(wavefrontMap, psfSamplingSize, 'opd', { rhoMax: 1.0 });

        throwIfCancelled(cancelToken);

        if (!zGrid || !Array.isArray(zGrid.z) || !Array.isArray(zGrid.z[0])) {
            throw new Error('Zernike render grid generation failed');
        }

        const s = Math.max(2, Math.floor(Number(psfSamplingSize)));
            // Row-major [y][x]
            const opdGrid = Array.from({ length: s }, () => new Float32Array(s));
            const ampGrid = Array.from({ length: s }, () => new Float32Array(s));
            const maskGrid = Array.from({ length: s }, () => Array(s).fill(false));
        const xCoords = new Float32Array(s);
        const yCoords = new Float32Array(s);
        for (let i = 0; i < s; i++) {
            xCoords[i] = Number(zGrid.x?.[i] ?? ((i / (s - 1 || 1)) * 2 - 1));
            yCoords[i] = Number(zGrid.y?.[i] ?? ((i / (s - 1 || 1)) * 2 - 1));
        }

        for (let iy = 0; iy < s; iy++) {
            if ((iy % 32) === 0) {
                throwIfCancelled(cancelToken);
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            const row = zGrid.z[iy];
            for (let ix = 0; ix < s; ix++) {
                const vWaves = row?.[ix];
                if (vWaves === null || !isFinite(vWaves)) {
                    maskGrid[iy][ix] = false;
                    opdGrid[iy][ix] = 0;
                    ampGrid[iy][ix] = 0;
                    continue;
                }
                maskGrid[iy][ix] = true;
                opdGrid[iy][ix] = Number(vWaves) * Number(wavelength);
                ampGrid[iy][ix] = 1.0;
            }
        }

        const opdData = {
            gridSize: s,
            wavelength: wavelength,
            gridData: {
                opd: opdGrid,
                amplitude: ampGrid,
                pupilMask: maskGrid,
                xCoords,
                yCoords
            }
        };

        let skippedCount = 0;
        
        // PSF計算器を初期化
        const psfCalculator = await getPSFCalculatorSingleton();
        
        // PSFを計算
        if (PSF_DEBUG) console.log(`🔬 [PSF] PSF計算中... (${psfSamplingSize}x${psfSamplingSize})`);
        const psfResult = await raceWithCancel(psfCalculator.calculatePSF(opdData, {
            samplingSize: psfSamplingSize,
            pupilDiameter: 10.0, // mm（適切な値に調整）
            focalLength: 100.0,  // mm（適切な値に調整）
            forceImplementation: performanceMode === 'auto' ? null : performanceMode,
            removeTilt: true,
            onProgress: (evt) => {
                const p = Number(evt?.percent);
                const msg = evt?.message || evt?.phase || 'PSF...';
                if (!Number.isFinite(p)) {
                    emitProgress(null, evt?.phase || 'psf', msg);
                    return;
                }
                // Map PSF progress 0..100 => overall 80..100
                const overall = 80 + 0.2 * p;
                emitProgress(overall, evt?.phase || 'psf', msg);
            }
        }), cancelToken);

        throwIfCancelled(cancelToken);

        emitProgress(100, 'psf', 'PSF done');

        const extract2D = (r) => r?.psfData || r?.psf || r?.intensity || null;
        const psf2D = extract2D(psfResult);
        const psfMethod = psfResult?.metadata?.method || psfResult?.metadata?.calculator || psfResult?.implementationUsed || 'unknown';

        const summarizePSF2D = (arr) => {
            if (!arr || !Array.isArray(arr) || !Array.isArray(arr[0])) return null;
            const h = arr.length;
            const w = arr[0].length;
            let sum = 0;
            let sumX = 0;
            let sumY = 0;
            let peak = -Infinity;
            let peakX = 0;
            let peakY = 0;
            // lightweight checksum: sample every Nth element to keep it cheap
            const step = Math.max(1, Math.floor(Math.max(h, w) / 32));
            let chk = 0x811c9dc5;
            for (let y = 0; y < h; y++) {
                const row = arr[y];
                for (let x = 0; x < w; x++) {
                    const v = Number(row[x]);
                    if (!isFinite(v)) continue;
                    sum += v;
                    sumX += v * x;
                    sumY += v * y;
                    if (v > peak) {
                        peak = v;
                        peakX = x;
                        peakY = y;
                    }
                    if ((x % step === 0) && (y % step === 0)) {
                        const q = Math.max(-1e9, Math.min(1e9, v));
                        const scaled = Math.floor(q * 1e6);
                        chk ^= (scaled & 0xff);
                        chk = Math.imul(chk, 0x01000193);
                    }
                }
            }
            const cx = sum > 0 ? (sumX / sum) : null;
            const cy = sum > 0 ? (sumY / sum) : null;
            return {
                checksum: ((chk >>> 0).toString(16)),
                size: `${w}x${h}`,
                peak,
                peakXY: [peakX, peakY],
                centroidXY: [cx, cy]
            };
        };

        const psfSummary = summarizePSF2D(psf2D);

        // Attach minimal provenance so users can confirm which sampling was used.
        try {
            psfResult.metadata = psfResult.metadata || {};
            psfResult.metadata.zernikeFitSamplingSize = zernikeFitSamplingSize;
            psfResult.metadata.psfSamplingSize = psfSamplingSize;
        } catch (_) {}

        // デバッグ時のみ、入力/OPD の状態を結果に添付（console 依存せず stats に出せるように）
        if (PSF_DEBUG) {
            let opdMin = Infinity;
            let opdMax = -Infinity;
            // gridData のOPD[μm]からmin/maxを集計
            for (let ix = 0; ix < gridSize; ix++) {
                for (let iy = 0; iy < gridSize; iy++) {
                    if (!opdData?.gridData?.pupilMask?.[ix]?.[iy]) continue;
                    const v = opdData?.gridData?.opd?.[ix]?.[iy];
                    if (!isFinite(v)) continue;
                    if (v < opdMin) opdMin = v;
                    if (v > opdMax) opdMax = v;
                }
            }
            psfResult.diagnostics = {
                opticalSystemRows: opticalSystemRows.length,
                opticalSystemSource,
                opticalSystemChecksum: opticalSystemSummary.checksum,
                opticalSystemFirst: opticalSystemSummary.first,
                opticalSystemLast: opticalSystemSummary.last,
                objectIndex,
                objectType,
                objectX,
                objectY,
                wavelength,
                gridSize,
                pupilRadius,
                raysTotal: gridSize * gridSize,
                raysInsidePupil: null,
                raysUsed: null,
                raysSkipped: skippedCount,
                opdMinMicrons: isFinite(opdMin) ? opdMin : null,
                opdMaxMicrons: isFinite(opdMax) ? opdMax : null,
                psfMethod,
                psfChecksum: psfSummary?.checksum || null,
                psfSize: psfSummary?.size || null,
                psfPeakXY: psfSummary?.peakXY || null,
                psfCentroidXY: psfSummary?.centroidXY || null
            };

            const countInside = (() => {
                let c = 0;
                for (let ix = 0; ix < gridSize; ix++) {
                    for (let iy = 0; iy < gridSize; iy++) {
                        if (opdData?.gridData?.pupilMask?.[ix]?.[iy]) c++;
                    }
                }
                return c;
            })();

            console.log(
                `🧪 [PSF][diag] sys=${opticalSystemSource} n=${opticalSystemRows.length} chk=${opticalSystemSummary.checksum} obj=${objectIndex} field=(${objectX},${objectY}) OPD[μm]=${isFinite(opdMin) ? opdMin.toFixed(4) : 'n/a'}..${isFinite(opdMax) ? opdMax.toFixed(4) : 'n/a'} grid=${gridSize} inside=${countInside} skip=${skippedCount} psf=${psfSummary?.size || 'n/a'} psfChk=${psfSummary?.checksum || 'n/a'} method=${psfMethod}`
            );
        }
        
        // プロッターを初期化
        const plotter = new PSFPlotter(options?.containerElement || 'psf-container');
        
        // プロットタイプに応じて表示
        const plotOptions = {
            logScale: logScale,
            showMetrics: true,
            pixelSize: psfResult.options?.pixelSize || 1.0
        };
        
        switch (plotType) {
            case '2d':
                await plotter.plot2DPSF(psfResult, plotOptions);
                break;
            case '3d':
                await plotter.plot3DPSF(psfResult, plotOptions);
                break;
            case 'encircled':
                await plotter.plotEncircledEnergy(psfResult, plotOptions);
                break;
            default:
                await plotter.plot3DPSF(psfResult, plotOptions);
        }
        
        // 統計情報を表示
        plotter.displayStatistics(psfResult, options?.statsElement || 'psf-container-stats');

        // === Persist last PSF status for AI context / other windows ===
        // (Popup PSF uses showPSFDiagram; it does not go through handlePSFCalculation.)
        try {
            window.lastPsfResult = psfResult;
            window.lastPsfObjectData = selectedObject;
            window.lastPsfWavelength = wavelength;
            window.lastPsfGridSize = psfSamplingSize;
            window.lastPsfDebugMode = false;
            window.lastPsfError = null;

            const metrics = psfResult?.metrics || psfResult?.characteristics || null;
            const summary = {
                at: new Date().toISOString(),
                wavelength: psfResult?.wavelength ?? wavelength ?? null,
                gridSize: psfResult?.gridSize ?? psfSamplingSize ?? null,
                calculationTime: psfResult?.calculationTime ?? null,
                hasMetrics: !!metrics,
                metricKeys: metrics ? Object.keys(metrics).slice(0, 30) : [],
                objectIndex: Number.isFinite(objectIndex) ? objectIndex : null,
                zernikeFitSamplingSize: zernikeFitSamplingSize ?? null,
                performanceMode: performanceMode ?? null,
                psfMethod: psfMethod ?? null,
                psfSummary: psfSummary || null,
            };
            localStorage.setItem('lastPsfMeta', JSON.stringify(summary));
            localStorage.removeItem('lastPsfError');
        } catch (_) {}
        
        if (PSF_DEBUG) console.log('✅ [PSF] PSF表示完了');

        return psfResult;
        
    } catch (error) {
        if (error && (error.code === 'CANCELLED' || String(error.message || '').toLowerCase().includes('cancel'))) {
            console.warn('🟡 [PSF] Calculation cancelled:', error.message || error);
            return;
        }
        console.error('❌ [PSF] PSF表示エラー:', error);

        // Persist token-light error snapshot for AI context / other windows
        try {
            const rawMessage = String(error?.message || 'PSF calculation failed');
            const hintIdx = rawMessage.indexOf('hint=');
            const hint = hintIdx >= 0 ? rawMessage.slice(hintIdx + 'hint='.length).trim() : '';

            window.lastPsfError = {
                at: new Date().toISOString(),
                code: error?.code ?? null,
                message: rawMessage,
                rawMessage,
                hint,
                wavelength: (typeof wavelength !== 'undefined') ? wavelength : null,
                gridSize: (typeof psfSamplingSize !== 'undefined') ? psfSamplingSize : null,
                objectIndex: (typeof objectIndex === 'number') ? objectIndex : null,
                zernikeFitSamplingSize: (typeof zernikeFitSamplingSize !== 'undefined') ? zernikeFitSamplingSize : null,
                performanceMode: (typeof performanceMode !== 'undefined') ? performanceMode : null,
            };
            localStorage.setItem('lastPsfError', JSON.stringify(window.lastPsfError));
        } catch (_) {}
        
        // エラーメッセージを表示
        const container = options?.containerElement || document.getElementById('psf-container');
        if (container) {
            container.innerHTML = `
                <div style="color: red; text-align: center; padding: 20px;">
                    <strong>PSF計算エラー</strong><br>
                    ${error.message}<br><br>
                    <small>まずOptical Path DifferenceセクションでOPDデータを生成してください。</small>
                </div>
            `;
        }
        
        throw error;
    }
}

if (typeof window !== 'undefined') {
    window.showPSFDiagram = showPSFDiagram;
}

/**
 * PSF Object選択肢のセットアップ
 */
function setupPSFObjectSelect() {
    if (globalThis.__PSF_DEBUG) console.log('🔄 [PSF] Object選択肢のセットアップ開始');
    
    // Object selectの初期化
    const objectSelect = document.getElementById('psf-object-select');
    if (!objectSelect) {
        if (globalThis.__PSF_DEBUG) console.warn('❌ [PSF] psf-object-select要素が見つかりません');
        return;
    }
    
    // 複数のソースからObjectデータを取得を試行
    let objects = [];
    
    // 方法1: window.getObjectRows
    if (typeof window.getObjectRows === 'function') {
        try {
            objects = window.getObjectRows();
            if (globalThis.__PSF_DEBUG) console.log('📊 [PSF] getObjectRows()からデータ取得:', objects.length, '個');
        } catch (error) {
            if (globalThis.__PSF_DEBUG) console.warn('⚠️ [PSF] getObjectRows()でエラー:', error);
        }
    }
    
    // 方法2: window.tableObject
    if ((!objects || objects.length === 0) && window.tableObject) {
        try {
            objects = window.tableObject.getData();
            if (globalThis.__PSF_DEBUG) console.log('📊 [PSF] tableObject.getData()からデータ取得:', objects.length, '個');
        } catch (error) {
            if (globalThis.__PSF_DEBUG) console.warn('⚠️ [PSF] tableObject.getData()でエラー:', error);
        }
    }
    
    // 方法3: window.objectTabulator
    if ((!objects || objects.length === 0) && window.objectTabulator) {
        try {
            objects = window.objectTabulator.getData();
            if (globalThis.__PSF_DEBUG) console.log('📊 [PSF] objectTabulator.getData()からデータ取得:', objects.length, '個');
        } catch (error) {
            if (globalThis.__PSF_DEBUG) console.warn('⚠️ [PSF] objectTabulator.getData()でエラー:', error);
        }
    }
    
    // 有効なObjectデータのみ（ただし value は「元配列のインデックス」を保持する）
    const validEntries = [];
    for (let i = 0; i < (Array.isArray(objects) ? objects.length : 0); i++) {
        const obj = objects[i];
        if (!obj || obj.id === undefined || obj.id === null) continue;
        validEntries.push({ index: i, obj });
    }
    
    // 現在の選択を保存
    const currentSelectedValue = objectSelect.value;
    const currentSelectedIndex = objectSelect.selectedIndex;
    if (globalThis.__PSF_DEBUG) console.log('🔍 [PSF] 現在の選択を保存:', { value: currentSelectedValue, index: currentSelectedIndex });
    
    // 選択肢を更新
    objectSelect.innerHTML = '';
    
    if (validEntries.length > 0) {
        validEntries.forEach((entry, displayIndex) => {
            const obj = entry.obj;
            const option = document.createElement('option');
            // IMPORTANT: keep original row index so downstream uses getObjectRows()[index]
            option.value = String(entry.index);
            
            // Object表示名を生成（座標情報含む）
            const xValue = (obj.x ?? obj.xHeightAngle ?? 0);
            const yValue = (obj.y ?? obj.yHeightAngle ?? 0);
            option.textContent = `Object ${displayIndex + 1} (${Number(xValue).toFixed(2)}, ${Number(yValue).toFixed(2)})`;
            
            objectSelect.appendChild(option);
        });
        
        // 以前の選択を復元
        if (currentSelectedValue !== null && currentSelectedValue !== '' && Array.from(objectSelect.options).some(o => o.value === currentSelectedValue)) {
            objectSelect.value = currentSelectedValue;
            if (globalThis.__PSF_DEBUG) console.log('✅ [PSF] 以前の選択を復元:', currentSelectedValue);
        } else if (currentSelectedIndex >= 0 && currentSelectedIndex < objectSelect.options.length) {
            objectSelect.selectedIndex = currentSelectedIndex;
            if (globalThis.__PSF_DEBUG) console.log('✅ [PSF] 以前の選択インデックスを復元:', currentSelectedIndex);
        }
        
        if (globalThis.__PSF_DEBUG) console.log('✅ [PSF] Object選択肢を更新:', validEntries.length, '個');
    } else {
        // デフォルトオプションを追加
        const defaultOption = document.createElement('option');
        defaultOption.value = 0;
        defaultOption.textContent = 'Object 1 (データ未設定)';
        objectSelect.appendChild(defaultOption);
        if (globalThis.__PSF_DEBUG) console.log('⚠️ [PSF] Objectデータなし、デフォルト選択肢を設定');
    }

    // 現在のObject内容シグネチャを保存（config切替などで内容が変わったか判定するため）
    try {
        const objectsNow = window.getObjectRows ? window.getObjectRows() : (window.tableObject ? window.tableObject.getData() : []);
        const validNow = Array.isArray(objectsNow)
            ? objectsNow.map((obj, i) => ({ obj, i })).filter(e => e.obj && e.obj.id !== undefined && e.obj.id !== null)
            : [];
        const signature = validNow.map(e => {
            const obj = e.obj;
            const id = obj.id;
            const x = Number(obj.x ?? obj.xHeightAngle ?? 0);
            const y = Number(obj.y ?? obj.yHeightAngle ?? 0);
            const type = obj.type ?? obj.objectType ?? '';
            return `${e.i}:${id}:${type}:${x.toFixed(6)}:${y.toFixed(6)}`;
        }).join('|');
        objectSelect.dataset.psfObjectSignature = signature;
    } catch {
        // ignore
    }
}

/**
 * PSF Object選択肢を強制更新（テーブル変更時に呼び出し）
 */
function updatePSFObjectOptions() {
    if (globalThis.__PSF_DEBUG) console.log('🔄 [PSF] Object選択肢の強制更新');
    
    const objectSelect = document.getElementById('psf-object-select');
    if (!objectSelect) {
        setupPSFObjectSelect();
        return;
    }

    const currentValue = objectSelect.value;
    const currentText = objectSelect.options[objectSelect.selectedIndex]?.text;
    if (globalThis.__PSF_DEBUG) console.log('🔍 [PSF] 更新前の選択状態:', { value: currentValue, text: currentText });

    // オプション数だけではConfig切替（同じ件数で中身が変わる）を検出できないため、内容シグネチャで判定
    let newSignature = '';
    try {
        const objects = window.getObjectRows ? window.getObjectRows() : (window.tableObject ? window.tableObject.getData() : []);
        const validObjects = Array.isArray(objects)
            ? objects.map((obj, i) => ({ obj, i })).filter(e => e.obj && e.obj.id !== undefined && e.obj.id !== null)
            : [];
        newSignature = validObjects.map(e => {
            const obj = e.obj;
            const id = obj.id;
            const x = Number(obj.x ?? obj.xHeightAngle ?? 0);
            const y = Number(obj.y ?? obj.yHeightAngle ?? 0);
            const type = obj.type ?? obj.objectType ?? '';
            return `${e.i}:${id}:${type}:${x.toFixed(6)}:${y.toFixed(6)}`;
        }).join('|');
    } catch {
        // ignore
    }

    const oldSignature = objectSelect.dataset.psfObjectSignature || '';
    if (oldSignature === newSignature && objectSelect.options.length > 0) {
        if (globalThis.__PSF_DEBUG) console.log('🔍 [PSF] Object内容が同じのため更新をスキップ');
        return;
    }

    setupPSFObjectSelect();
    objectSelect.dataset.psfObjectSignature = newSignature;
}

// 外部（Configuration切替など）から呼べるように公開
if (typeof window !== 'undefined') {
    window.updatePSFObjectOptions = updatePSFObjectOptions;
    window.setupPSFObjectSelect = setupPSFObjectSelect;

    // Debug helper: dump expanded-row provenance (_blockType/_blockId)
    window.dumpOpticalSystemProvenance = function dumpOpticalSystemProvenance(options = {}) {
        const quiet = !!options?.quiet;
        const raw = localStorage.getItem('OpticalSystemTableData');
        if (!raw) {
            if (!quiet) console.warn('No OpticalSystemTableData found');
            return { groups: {}, summary: [] };
        }

        let rows;
        try {
            rows = JSON.parse(raw);
        } catch (e) {
            if (!quiet) console.error('Failed to parse OpticalSystemTableData', e);
            return { groups: {}, summary: [] };
        }

        // --- group by _blockId ---
        /** @type {Record<string, { blockType: string, rows: Array<{ row: any, surfaceIndex: number }> }>} */
        const groups = {};
        (Array.isArray(rows) ? rows : []).forEach((row, i) => {
            const blockId = row?._blockId ?? '(none)';
            if (!groups[blockId]) {
                groups[blockId] = {
                    blockType: row?._blockType ?? '(none)',
                    rows: []
                };
            }
            groups[blockId].rows.push({ row, surfaceIndex: i });
        });

        // --- display ---
        const summary = [];

        Object.entries(groups).forEach(([blockId, g]) => {
            const count = g.rows.length;
            summary.push({
                blockId,
                blockType: g.blockType,
                surfaceCount: count
            });

            if (!quiet) {
                console.group(`Block ${blockId} : ${g.blockType} (${count} surfaces)`);
                console.table(
                    g.rows.map(({ row, surfaceIndex }) => ({
                        surfaceIndex,
                        uiIndex: surfaceIndex + 1,
                        type: row?.surfType ?? row?.type,
                        radius: row?.radius,
                        thickness: row?.thickness,
                        material: row?.material
                    }))
                );
                console.groupEnd();
            }
        });

        // --- overall summary ---
        if (!quiet) {
            console.log('Block summary:');
            console.table(summary);
        }

        // DevTools $1 用
        return { groups, summary };
    };

    window.renderBlockInspector = renderBlockInspector;
    window.refreshBlockInspector = refreshBlockInspector;

    // Dev helper: Surface edit -> Block change mapping (Apply to Design Intent)
    window.mapSurfaceEditToBlockChange = __blocks_mapSurfaceEditToBlockChange;

    // ------------------------------------------------------------
    // Dev helper: focus scan (defocus vs spot)
    // ------------------------------------------------------------
    // Usage (DevTools console):
    //   await window.__debugFocusScan({ startMm:-30, endMm:30, steps:31 })
    // Output:
    //   - defocusWaves: Noll=5 coefficient in waves (reference-sphere OPD)
    //   - spotRmsMm: geometric RMS spot radius at Image surface (same configuration)
    //   - evalSurfaceIndex: internal OPD evaluation surface index (should match imageIndex)
    window.__debugFocusScan = async (options = {}) => {
        const opts = options && typeof options === 'object' ? options : {};
        const startMm = Number.isFinite(Number(opts.startMm)) ? Number(opts.startMm) : -30;
        const endMm = Number.isFinite(Number(opts.endMm)) ? Number(opts.endMm) : 30;
        const steps = Number.isFinite(Number(opts.steps)) ? Math.max(3, Math.floor(Number(opts.steps))) : 31;
        const rayCount = Number.isFinite(Number(opts.rayCount)) ? Math.max(5, Math.floor(Number(opts.rayCount))) : 21;
        const rings = Number.isFinite(Number(opts.rings)) ? Math.max(2, Math.floor(Number(opts.rings))) : 4;
        const spokes = Number.isFinite(Number(opts.spokes)) ? Math.max(6, Math.floor(Number(opts.spokes))) : 12;

        const tbl = window.tableOpticalSystem || globalThis.tableOpticalSystem;
        const rows0 = (tbl && typeof tbl.getData === 'function') ? tbl.getData() : null;
        if (!Array.isArray(rows0) || rows0.length < 2) throw new Error('OpticalSystem rows not available');

        const sourceRows = (window.tableSource && typeof window.tableSource.getData === 'function') ? window.tableSource.getData() : [];
        const objectRows = (window.tableObject && typeof window.tableObject.getData === 'function') ? window.tableObject.getData() : [];

        const getPrimaryWavelength = () => {
            try {
                if (typeof window.getPrimaryWavelength === 'function') {
                    const w = Number(window.getPrimaryWavelength());
                    if (Number.isFinite(w) && w > 0) return w;
                }
            } catch (_) {}
            // fallback: classic d line
            return 0.5876;
        };

        const wavelength = Number.isFinite(Number(opts.wavelengthUm)) ? Number(opts.wavelengthUm) : getPrimaryWavelength();
        const objRow0 = Array.isArray(objectRows) && objectRows.length > 0 ? objectRows[0] : {};

        const isInfinite = (() => {
            const t0 = rows0[0]?.thickness;
            if (t0 === Infinity) return true;
            const s = String(t0 ?? '').trim();
            return /^inf(inity)?$/i.test(s);
        })();

        // Center field
        const fieldSetting = (() => {
            try {
                // imported from ../analysis/optical-analysis.js
                if (typeof createFieldSettingFromObject === 'function') {
                    return createFieldSettingFromObject(objRow0, 0, isInfinite);
                }
            } catch (_) {}
            return isInfinite
                ? { type: 'infinite', fieldAngle: { x: 0, y: 0 }, displayName: 'center' }
                : { type: 'finite', xHeight: 0, yHeight: 0, displayName: 'center' };
        })();

        const findImageIndex = (rows) => {
            let lastImageIndex = -1;
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                const surfType = String(r?.surfType ?? r?.['surf type'] ?? r?.surfTypeName ?? '').toLowerCase();
                const objectType = String(r?.['object type'] ?? r?.object ?? r?.Object ?? '').toLowerCase();
                const comment = String(r?.comment ?? r?.Comment ?? '').toLowerCase();
                if (surfType.includes('image') || objectType.includes('image') || comment.includes('image')) lastImageIndex = i;
            }
            return lastImageIndex >= 0 ? lastImageIndex : (rows.length - 1);
        };

        const imageIndex0 = findImageIndex(rows0);
        const preImageIndex0 = Math.max(0, imageIndex0 - 1);
        const baseThickness = (() => {
            const v = rows0?.[preImageIndex0]?.thickness;
            const n = Number.parseFloat(String(v ?? '0'));
            return Number.isFinite(n) ? n : 0;
        })();

        const sampleUnitDisk = () => {
            /** @type {{x:number,y:number}[]} */
            const pts = [];
            pts.push({ x: 0, y: 0 });
            for (let ir = 1; ir <= rings; ir++) {
                const r = ir / rings;
                for (let it = 0; it < spokes; it++) {
                    const t = (2 * Math.PI * it) / spokes;
                    pts.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
                }
            }
            return pts;
        };

        const calcWavefrontMetrics = async (rows) => {
            const { createOPDCalculator, WavefrontAberrationAnalyzer } = await import('../eva-wavefront.js');
            const opdCalculator = createOPDCalculator(rows, wavelength);
            const analyzer = new WavefrontAberrationAnalyzer(opdCalculator);
            try {
                opdCalculator.setReferenceRay(fieldSetting);
            } catch (e) {
                return { defocusWaves: NaN, sphericalWaves: NaN, wfeRmsWavesPT: NaN, wfeRmsWavesPTD: NaN, opdSampleCount: 0, evalSurfaceIndex: opdCalculator?.evaluationSurfaceIndex ?? null, error: e };
            }

            const pts = sampleUnitDisk();
            const pupilCoordinates = [];
            const opds = [];
            const tryOpts = [{ fastMarginalRay: true }, { fastMarginalRay: false }];

            for (const o of tryOpts) {
                pupilCoordinates.length = 0;
                opds.length = 0;
                for (const p of pts) {
                    let opd = NaN;
                    try {
                        opd = opdCalculator.calculateOPDReferenceSphere(p.x, p.y, fieldSetting, false, o);
                    } catch (_) {
                        opd = NaN;
                    }
                    if (!Number.isFinite(opd)) continue;
                    pupilCoordinates.push({ x: p.x, y: p.y, r: Math.sqrt(p.x * p.x + p.y * p.y) });
                    opds.push(opd);
                }
                if (pupilCoordinates.length >= 6) break;
            }

            if (pupilCoordinates.length < 6) {
                return {
                    defocusWaves: NaN,
                    sphericalWaves: NaN,
                    wfeRmsWavesPT: NaN,
                    wfeRmsWavesPTD: NaN,
                    opdSampleCount: pupilCoordinates.length,
                    evalSurfaceIndex: opdCalculator?.evaluationSurfaceIndex ?? null,
                    error: new Error('insufficient-valid-opd-samples')
                };
            }

            const wavefrontMap = { pupilCoordinates, opds };

            const readCoeff = (coeffObj, j) => {
                if (!coeffObj) return NaN;
                const v = (typeof coeffObj.get === 'function') ? coeffObj.get(j) : (coeffObj[j] ?? coeffObj[String(j)]);
                return Number.isFinite(Number(v)) ? Number(v) : NaN;
            };

            const rmsResidualWaves = (removedModelMicrons) => {
                if (!Array.isArray(removedModelMicrons) || removedModelMicrons.length !== opds.length) return NaN;
                const wl = wavelength;
                if (!(Number.isFinite(wl) && wl > 0)) return NaN;
                let sum2 = 0;
                let count = 0;
                for (let i = 0; i < opds.length; i++) {
                    const opd = opds[i];
                    const model = removedModelMicrons[i];
                    if (!Number.isFinite(opd) || !Number.isFinite(model)) continue;
                    const residWaves = (opd - model) / wl;
                    sum2 += residWaves * residWaves;
                    count++;
                }
                return count > 0 ? Math.sqrt(sum2 / count) : NaN;
            };

            const getFitWithRemoved = (removeList) => {
                let prev = undefined;
                try { prev = globalThis.__WAVEFRONT_REMOVE_NOLL; } catch (_) {}
                try { globalThis.__WAVEFRONT_REMOVE_NOLL = Array.isArray(removeList) ? removeList : []; } catch (_) {}
                try {
                    return analyzer.fitZernikePolynomials(wavefrontMap, 15);
                } finally {
                    try {
                        if (prev === undefined) {
                            delete globalThis.__WAVEFRONT_REMOVE_NOLL;
                        } else {
                            globalThis.__WAVEFRONT_REMOVE_NOLL = prev;
                        }
                    } catch (_) {}
                }
            };

            // Full coefficients (for defocus/spherical) are returned regardless of removed model.
            const fitPT = getFitWithRemoved([1, 2, 3]);
            const fitPTD = getFitWithRemoved([1, 2, 3, 5]);

            const defocusWaves = readCoeff(fitPT?.coefficientsWaves, 5);
            // NOTE: In this codebase, Noll index mapping is sequential in m for each n:
            //   j0=n(n+1)/2+1, m=-n,-n+2,...,n.
            // Thus spherical (n=4,m=0) is j=13 (not 11).
            const sphericalWaves = readCoeff(fitPT?.coefficientsWaves, 13);
            const wfeRmsWavesPT = rmsResidualWaves(fitPT?.removedModelMicrons);
            const wfeRmsWavesPTD = rmsResidualWaves(fitPTD?.removedModelMicrons);

            return {
                defocusWaves,
                sphericalWaves,
                wfeRmsWavesPT,
                wfeRmsWavesPTD,
                opdSampleCount: pupilCoordinates.length,
                evalSurfaceIndex: opdCalculator?.evaluationSurfaceIndex ?? null
            };
        };

        const calcSpotRmsMm = async (rows, imageIndex) => {
            const positionsFinite = [{ x: 0, y: 0, z: 0 }];
            const anglesInf = [{ x: 0, y: 0 }];

            let crossBeamResult = null;
            if (isInfinite && typeof window.generateInfiniteSystemCrossBeam === 'function') {
                crossBeamResult = await window.generateInfiniteSystemCrossBeam(rows, anglesInf, {
                    rayCount,
                    debugMode: false,
                    wavelength,
                    crossType: 'both',
                    angleUnit: 'deg',
                    chiefZ: -20,
                    targetSurfaceIndex: imageIndex
                });
            } else if (!isInfinite && typeof window.generateCrossBeam === 'function') {
                crossBeamResult = await window.generateCrossBeam(rows, positionsFinite, {
                    rayCount,
                    debugMode: false,
                    wavelength,
                    crossType: 'both'
                });
            }

            /** @type {{x:number,y:number}[]} */
            const pts = [];
            if (crossBeamResult) {
                if (Array.isArray(crossBeamResult.rays) && crossBeamResult.rays.length > 0) {
                    for (const ray of crossBeamResult.rays) {
                        const p = ray?.rayPath?.[imageIndex];
                        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) pts.push({ x: p.x, y: p.y });
                    }
                } else if (Array.isArray(crossBeamResult.objectResults)) {
                    for (const obj of crossBeamResult.objectResults) {
                        const traced = Array.isArray(obj?.tracedRays) ? obj.tracedRays : [];
                        for (const ray of traced) {
                            const p = ray?.rayPath?.[imageIndex];
                            if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) pts.push({ x: p.x, y: p.y });
                        }
                    }
                }
            }

            if (pts.length === 0) return NaN;
            let sum = 0;
            for (const p of pts) sum += (p.x * p.x + p.y * p.y);
            return Math.sqrt(sum / pts.length);
        };

        const results = [];
        for (let k = 0; k < steps; k++) {
            const t = steps === 1 ? 0 : (k / (steps - 1));
            const delta = startMm + (endMm - startMm) * t;
            const rows = rows0.map(r => (r && typeof r === 'object') ? { ...r } : r);

            // Move image plane by adjusting spacing into the Image surface.
            const newTh = baseThickness + delta;
            if (rows[preImageIndex0] && typeof rows[preImageIndex0] === 'object') {
                rows[preImageIndex0].thickness = newTh;
            }

            const imageIndex = findImageIndex(rows);
            const wf = await calcWavefrontMetrics(rows);
            const spot = await calcSpotRmsMm(rows, imageIndex);

            const strehlFromSigmaWaves = (sigmaWaves) => {
                const s = Number(sigmaWaves);
                if (!Number.isFinite(s) || s < 0) return NaN;
                // Maréchal approximation: S ≈ exp(-(2πσ)^2), σ in waves RMS
                const a = 2 * Math.PI * s;
                const st = Math.exp(-(a * a));
                return Number.isFinite(st) ? Math.max(0, Math.min(1, st)) : NaN;
            };

            results.push({
                deltaMm: delta,
                preImageThicknessMm: newTh,
                imageIndex,
                evalSurfaceIndex: wf.evalSurfaceIndex,
                defocusWaves: wf.defocusWaves,
                sphericalWaves: wf.sphericalWaves,
                wfeRmsWavesPT: wf.wfeRmsWavesPT,
                wfeRmsWavesPTD: wf.wfeRmsWavesPTD,
                strehlPT: strehlFromSigmaWaves(wf.wfeRmsWavesPT),
                strehlPTD: strehlFromSigmaWaves(wf.wfeRmsWavesPTD),
                opdSampleCount: wf.opdSampleCount,
                spotRmsMm: spot
            });
        }

        const finite = (v) => Number.isFinite(Number(v));
        const bestDef = results
            .filter(r => finite(r.defocusWaves))
            .slice()
            .sort((a, b) => Math.abs(a.defocusWaves) - Math.abs(b.defocusWaves))[0] || null;
        const bestSpot = results
            .filter(r => finite(r.spotRmsMm))
            .slice()
            .sort((a, b) => a.spotRmsMm - b.spotRmsMm)[0] || null;

        const bestWfePTD = results
            .filter(r => finite(r.wfeRmsWavesPTD))
            .slice()
            .sort((a, b) => a.wfeRmsWavesPTD - b.wfeRmsWavesPTD)[0] || null;

        const bestStrehlPTD = results
            .filter(r => finite(r.strehlPTD))
            .slice()
            .sort((a, b) => b.strehlPTD - a.strehlPTD)[0] || null;

        console.table(results.map(r => ({
            deltaMm: Number(r.deltaMm.toFixed(3)),
            preImgT: Number(r.preImageThicknessMm.toFixed(3)),
            defocusWaves: finite(r.defocusWaves) ? Number(r.defocusWaves.toFixed(6)) : null,
            sphericalWaves: finite(r.sphericalWaves) ? Number(r.sphericalWaves.toFixed(6)) : null,
            wfeRmsWavesPT: finite(r.wfeRmsWavesPT) ? Number(r.wfeRmsWavesPT.toFixed(6)) : null,
            wfeRmsWavesPTD: finite(r.wfeRmsWavesPTD) ? Number(r.wfeRmsWavesPTD.toFixed(6)) : null,
            strehlPT: finite(r.strehlPT) ? Number(r.strehlPT.toFixed(6)) : null,
            strehlPTD: finite(r.strehlPTD) ? Number(r.strehlPTD.toFixed(6)) : null,
            log10StrehlPT: finite(r.strehlPT) && r.strehlPT > 0 ? Number(Math.log10(r.strehlPT).toFixed(3)) : null,
            log10StrehlPTD: finite(r.strehlPTD) && r.strehlPTD > 0 ? Number(Math.log10(r.strehlPTD).toFixed(3)) : null,
            opdSamples: Number.isFinite(Number(r.opdSampleCount)) ? Number(r.opdSampleCount) : null,
            spotRmsMm: finite(r.spotRmsMm) ? Number(r.spotRmsMm.toFixed(6)) : null,
            imageIndex: r.imageIndex,
            evalSurfaceIndex: r.evalSurfaceIndex
        })));

        console.log('🧪 [FocusScan] wl(um)=', wavelength, 'isInfinite=', isInfinite, 'imageIndex0=', imageIndex0, 'preImageIndex0=', preImageIndex0, 'baseThickness(mm)=', baseThickness);
        console.log('🧪 [FocusScan] bestDefocus≈0 at delta(mm)=', bestDef?.deltaMm, 'defocusWaves=', bestDef?.defocusWaves);
        console.log('🧪 [FocusScan] bestSpot(min RMS) at delta(mm)=', bestSpot?.deltaMm, 'spotRmsMm=', bestSpot?.spotRmsMm);
        console.log('🧪 [FocusScan] bestWfePTD(min) at delta(mm)=', bestWfePTD?.deltaMm, 'wfeRmsWavesPTD=', bestWfePTD?.wfeRmsWavesPTD);
        console.log('🧪 [FocusScan] bestStrehlPTD(max) at delta(mm)=', bestStrehlPTD?.deltaMm, 'strehlPTD=', bestStrehlPTD?.strehlPTD);
        if (bestDef && bestSpot) {
            console.log('🧪 [FocusScan] separation(mm)=', (bestSpot.deltaMm - bestDef.deltaMm));
        }

        return { results, bestDefocus: bestDef, bestSpot, bestWfePTD, bestStrehlPTD };
    };
}

// System Configuration管理モジュール
// 複数のConfigurationを保存・切り替え可能にする

const STORAGE_KEY = "systemConfigurations";

// 初期Configuration構造
function createDefaultConfiguration(id, name) {
    const defaultBlocks = [
        {
            blockId: 'ObjectPlane-1',
            blockType: 'ObjectPlane',
            role: null,
            constraints: {},
            parameters: {
                objectDistanceMode: 'INF'
            },
            variables: {},
            metadata: { source: 'default' }
        },
        {
            blockId: 'Stop-1',
            blockType: 'Stop',
            role: null,
            constraints: {},
            parameters: {
                semiDiameter: DEFAULT_STOP_SEMI_DIAMETER
            },
            variables: {},
            metadata: { source: 'default' }
        },
        {
            blockId: 'ImagePlane-1',
            blockType: 'ImagePlane',
            role: null,
            constraints: {},
            parameters: undefined,
            variables: {},
            metadata: { source: 'default' }
        }
    ];

  return {
    id: id,
    name: name,
        // Block schema (canonical). Empty array means "no blocks yet" but still editable.
        schemaVersion: BLOCK_SCHEMA_VERSION,
        blocks: defaultBlocks,
    source: [],
    object: [],
    opticalSystem: [],
    meritFunction: [],
    metadata: {
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      optimizationTarget: null,  // 将来のAI最適化用
      locked: false
    }
  };
}

// システム全体のConfiguration状態を管理
const defaultSystemConfig = {
  configurations: [
    createDefaultConfiguration(1, "Config 1")
  ],
  activeConfigId: 1,
  optimizationRules: {}  // フェーズ4用（空で準備）
};

// localStorageからConfiguration全体を読み込み
export function loadSystemConfigurations() {
  console.log('🔵 [Configuration] Loading system configurations from localStorage...');
  const json = localStorage.getItem(STORAGE_KEY);
  
  if (json) {
    try {
      const parsed = JSON.parse(json);
      console.log('🔵 [Configuration] Loaded configurations:', parsed.configurations.length);
      return parsed;
    } catch (e) {
      console.warn('⚠️ [Configuration] Parse error:', e);
      console.warn("Configuration読み込みに失敗しました。デフォルトを使用します。");
    }
  }
  
  console.log('🔵 [Configuration] Using default system config');
  return defaultSystemConfig;
}

// Configuration全体を保存
export function saveSystemConfigurations(systemConfig) {
  console.log('🔵 [Configuration] Saving system configurations...');
  if (systemConfig && systemConfig.configurations) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(systemConfig));
    console.log(`💾 [Configuration] Saved ${systemConfig.configurations.length} configurations`);
  } else {
    console.warn('⚠️ [Configuration] Invalid system config, not saving:', systemConfig);
  }
}

// アクティブなConfigurationを取得
export function getActiveConfiguration() {
  const systemConfig = loadSystemConfigurations();
  const activeConfig = systemConfig.configurations.find(c => c.id === systemConfig.activeConfigId);
  
  if (!activeConfig) {
    console.warn('⚠️ [Configuration] Active config not found, using first');
    return systemConfig.configurations[0];
  }
  
  return activeConfig;
}

// アクティブなConfiguration IDを取得
export function getActiveConfigId() {
  const systemConfig = loadSystemConfigurations();
  return systemConfig.activeConfigId;
}

// アクティブなConfigurationを変更
export function setActiveConfiguration(configId) {
  const systemConfig = loadSystemConfigurations();
  const config = systemConfig.configurations.find(c => c.id === configId);
  
  if (!config) {
    console.error('❌ [Configuration] Config not found:', configId);
    return false;
  }
  
  systemConfig.activeConfigId = configId;
  saveSystemConfigurations(systemConfig);
  console.log(`✅ [Configuration] Active config changed to: ${config.name}`);
  return true;
}

// 現在のテーブルデータをアクティブなConfigurationに保存
export function saveCurrentToActiveConfiguration() {
  console.log('🔵 [Configuration] Saving current table data to active configuration...');
  
  const systemConfig = loadSystemConfigurations();
  const activeConfig = systemConfig.configurations.find(c => c.id === systemConfig.activeConfigId);
  
  if (!activeConfig) {
    console.error('❌ [Configuration] Active config not found');
    return;
  }
  
  // 各テーブルからデータを取得
  activeConfig.source = window.tableSource ? window.tableSource.getData() : [];
  activeConfig.object = window.tableObject ? window.tableObject.getData() : [];
  activeConfig.opticalSystem = window.tableOpticalSystem ? window.tableOpticalSystem.getData() : [];
  activeConfig.meritFunction = window.meritFunctionEditor ? window.meritFunctionEditor.getData() : [];
  
  // メタデータ更新
  activeConfig.metadata.modified = new Date().toISOString();
  
  // designer情報が存在しない場合はデフォルト値で初期化
  if (!activeConfig.metadata.designer) {
    activeConfig.metadata.designer = {
      type: "human",
      name: "user",
      confidence: null
    };
  }
  
  saveSystemConfigurations(systemConfig);
  console.log(`✅ [Configuration] Saved to: ${activeConfig.name}`);
}

// アクティブなConfigurationのデータをlocalStorageに展開（各テーブル用）
export function loadActiveConfigurationToTables() {
  console.log('🔵 [Configuration] Loading active configuration to tables...');
  
  const activeConfig = getActiveConfiguration();
  
  if (!activeConfig) {
    console.error('❌ [Configuration] No active config found');
    return;
  }
  
  // 各テーブルのlocalStorageに書き込み
  if (activeConfig.source) {
    localStorage.setItem('sourceTableData', JSON.stringify(activeConfig.source));
  }
  if (activeConfig.object) {
    localStorage.setItem('objectTableData', JSON.stringify(activeConfig.object));
  }
  if (activeConfig.opticalSystem) {
    localStorage.setItem('OpticalSystemTableData', JSON.stringify(activeConfig.opticalSystem));
  }
  if (activeConfig.meritFunction) {
    localStorage.setItem('meritFunctionData', JSON.stringify(activeConfig.meritFunction));
  }
  
  console.log(`✅ [Configuration] Loaded: ${activeConfig.name}`);
}

// 新しいConfigurationを追加
export function addConfiguration(name) {
  const systemConfig = loadSystemConfigurations();
  
  // 新しいID生成（最大ID + 1）
  const maxId = Math.max(...systemConfig.configurations.map(c => c.id), 0);
  const newId = maxId + 1;
  
  const newConfig = createDefaultConfiguration(newId, name);
  
  // 現在のアクティブなConfigurationのデータをコピー
  const activeConfig = getActiveConfiguration();
  if (activeConfig) {
    newConfig.source = JSON.parse(JSON.stringify(activeConfig.source));
    newConfig.object = JSON.parse(JSON.stringify(activeConfig.object));
    newConfig.opticalSystem = JSON.parse(JSON.stringify(activeConfig.opticalSystem));
    newConfig.meritFunction = JSON.parse(JSON.stringify(activeConfig.meritFunction));
  }
  
  systemConfig.configurations.push(newConfig);
  saveSystemConfigurations(systemConfig);
  
  console.log(`✅ [Configuration] Added new configuration: ${name} (ID: ${newId})`);
  return newId;
}

// Configurationを削除
export function deleteConfiguration(configId) {
  const systemConfig = loadSystemConfigurations();
  
  // 最後の1つは削除不可
  if (systemConfig.configurations.length <= 1) {
    console.warn('⚠️ [Configuration] Cannot delete last configuration');
    return false;
  }
  
  const index = systemConfig.configurations.findIndex(c => c.id === configId);
  
  if (index === -1) {
    console.error('❌ [Configuration] Config not found:', configId);
    return false;
  }
  
  const configName = systemConfig.configurations[index].name;
  systemConfig.configurations.splice(index, 1);
  
  // アクティブなConfigurationが削除された場合、最初のConfigurationをアクティブに
  if (systemConfig.activeConfigId === configId) {
    systemConfig.activeConfigId = systemConfig.configurations[0].id;
    console.log(`🔄 [Configuration] Active config changed to: ${systemConfig.configurations[0].name}`);
  }
  
  saveSystemConfigurations(systemConfig);
  console.log(`✅ [Configuration] Deleted configuration: ${configName}`);
  return true;
}

// Configurationを複製
export function duplicateConfiguration(configId) {
  const systemConfig = loadSystemConfigurations();
  const sourceConfig = systemConfig.configurations.find(c => c.id === configId);
  
  if (!sourceConfig) {
    console.error('❌ [Configuration] Config not found:', configId);
    return null;
  }
  
  // 新しいID生成
  const maxId = Math.max(...systemConfig.configurations.map(c => c.id), 0);
  const newId = maxId + 1;
  
  // 完全なコピーを作成
  const newConfig = JSON.parse(JSON.stringify(sourceConfig));
  newConfig.id = newId;
  newConfig.name = `${sourceConfig.name} (Copy)`;
  newConfig.metadata.created = new Date().toISOString();
  newConfig.metadata.modified = new Date().toISOString();
  
  systemConfig.configurations.push(newConfig);
  saveSystemConfigurations(systemConfig);
  
  console.log(`✅ [Configuration] Duplicated configuration: ${newConfig.name} (ID: ${newId})`);
  return newId;
}

// Configuration名を変更
export function renameConfiguration(configId, newName) {
  const systemConfig = loadSystemConfigurations();
  const config = systemConfig.configurations.find(c => c.id === configId);
  
  if (!config) {
    console.error('❌ [Configuration] Config not found:', configId);
    return false;
  }
  
  const oldName = config.name;
  config.name = newName;
  config.metadata.modified = new Date().toISOString();
  
  saveSystemConfigurations(systemConfig);
  console.log(`✅ [Configuration] Renamed: ${oldName} → ${newName}`);
  return true;
}

// 全Configuration一覧を取得（テーブル表示用）
export function getConfigurationList() {
  const systemConfig = loadSystemConfigurations();
  return systemConfig.configurations.map(c => ({
    id: c.id,
    name: c.name,
    active: c.id === systemConfig.activeConfigId,
    created: c.metadata.created,
    modified: c.metadata.modified,
    locked: c.metadata.locked
  }));
}

// グローバルにエクスポート
if (typeof window !== 'undefined') {
    // NOTE: table-configuration.js also exports window.ConfigurationManager.
    // Do not clobber it (it supports applyToUI refresh). Only fill missing methods.
    const prev = window.ConfigurationManager;
    const base = (prev && typeof prev === 'object') ? prev : {};
    window.ConfigurationManager = {
        ...base,
        loadSystemConfigurations: base.loadSystemConfigurations || loadSystemConfigurations,
        saveSystemConfigurations: base.saveSystemConfigurations || saveSystemConfigurations,
        getActiveConfiguration: base.getActiveConfiguration || getActiveConfiguration,
        getActiveConfigId: base.getActiveConfigId || getActiveConfigId,
        setActiveConfiguration: base.setActiveConfiguration || setActiveConfiguration,
        saveCurrentToActiveConfiguration: base.saveCurrentToActiveConfiguration || saveCurrentToActiveConfiguration,
        // Prefer existing loadActiveConfigurationToTables (applyToUI-capable)
        loadActiveConfigurationToTables: base.loadActiveConfigurationToTables || loadActiveConfigurationToTables,
        addConfiguration: base.addConfiguration || addConfiguration,
        deleteConfiguration: base.deleteConfiguration || deleteConfiguration,
        duplicateConfiguration: base.duplicateConfiguration || duplicateConfiguration,
        renameConfiguration: base.renameConfiguration || renameConfiguration,
        getConfigurationList: base.getConfigurationList || getConfigurationList,
    };
}

// Optimizer integration (Blocks is canonical): expose a small API for future optimization loop.
// UI does not use this directly; it is for debugging / future optimizer wiring.
try {
    if (typeof window !== 'undefined') {
        window.BlockDesignVariables = {
            listActive: () => {
                const cfg = getActiveConfiguration();
                return listDesignVariablesFromBlocks(cfg);
            },
            setActiveValue: (variableId, newValue) => {
                const systemConfig = (typeof loadSystemConfigurationsFromTableConfig === 'function')
                    ? loadSystemConfigurationsFromTableConfig()
                    : null;
                if (!systemConfig || !Array.isArray(systemConfig.configurations)) return false;
                const activeId = systemConfig.activeConfigId;
                const activeCfg = systemConfig.configurations.find(c => c && c.id === activeId) || systemConfig.configurations[0];
                if (!activeCfg) return false;

                const ok = setDesignVariableValue(activeCfg, variableId, newValue);
                if (!ok) return false;

                try {
                    if (!activeCfg.metadata) activeCfg.metadata = {};
                    activeCfg.metadata.modified = new Date().toISOString();
                } catch (_) {}

                if (typeof saveSystemConfigurationsFromTableConfig === 'function') {
                    saveSystemConfigurationsFromTableConfig(systemConfig);
                }

                try { refreshBlockInspector(); } catch (_) {}
                return true;
            }
        };
    }
} catch (_) {}

// =============================================================================
// Blocks / Apply-to-Design-Intent + Block Inspector (override clean)
// =============================================================================

function __blocks_isAutoOrInfValue(v) {
    const s = String(v ?? '').trim();
    if (s === '') return true;
    if (/^inf(inity)?$/i.test(s)) return true;
    if (/^(a|auto|u)$/i.test(s)) return true;
    return false;
}

function __blocks_isAutoOrBlankValue(v) {
    const s = String(v ?? '').trim();
    if (s === '') return true;
    if (/^(a|auto|u)$/i.test(s)) return true;
    return false;
}

function __blocks_isInfValue(v) {
    const s = String(v ?? '').trim();
    return /^inf(inity)?$/i.test(s);
}

function __blocks_explainSurfaceEditMappingFailure(edit) {
    try {
        const row = edit?.row;
        if (!row || typeof row !== 'object') return 'row missing';
        const blockId = row._blockId;
        const blockType = __blocks_normalizeProvenanceBlockType(row._blockType);
        const role = __blocks_normalizeRole(row._surfaceRole);
        const field = __blocks_normalizeEditedFieldKey(edit?.field);
        const oldValue = edit?.oldValue;
        const newValue = edit?.newValue;

        if (!blockId || blockId === '(none)') return 'missing provenance: _blockId';
        if (!blockType) return 'missing provenance: _blockType';
        if (!role) return 'missing provenance: _surfaceRole';
        if (!field) return 'field missing';
        if (oldValue === newValue) return 'no-op (oldValue === newValue)';
        if (__blocks_isAutoOrBlankValue(newValue)) return 'AUTO/blank value not mappable';
        if (__blocks_isInfValue(newValue) && field !== 'radius') return 'INF only allowed for radius';

        return 'field not supported or role mismatch';
    } catch (_) {
        return 'unknown mapping error';
    }
}

function __blocks_normalizeProvenanceBlockType(raw) {
    const s = String(raw ?? '').trim();
    if (s === '') return '';
    const key = s.replace(/\s+/g, '').replace(/[_-]+/g, '').toLowerCase();
    if (key === 'lens' || key === 'positivelens' || key === 'singlet') return 'Lens';
    if (key === 'doublet' || key === 'cementeddoublet') return 'Doublet';
    if (key === 'triplet' || key === 'cementedtriplet') return 'Triplet';
    if (key === 'stop' || key === 'aperturestop' || key === 'aperture') return 'Stop';
    if (key === 'gap' || key === 'airgap' || key === 'space' || key === 'air') return 'Gap';
    if (key === 'imageplane' || key === 'image') return 'ImagePlane';
    return s;
}

function __blocks_normalizeRole(raw) {
    const s = String(raw ?? '').trim();
    if (s === '') return '';
    return s.toLowerCase();
}

function __blocks_normalizeEditedFieldKey(field) {
    const s = String(field ?? '').trim();
    if (!s) return '';
    const key = s.replace(/\s+/g, '').replace(/[_-]+/g, '').toLowerCase();
    // Optimization flags (expanded surface table)
    if (key === 'optimizer') return 'optimizeR';
    if (key === 'optimizet') return 'optimizeT';
    if (key === 'optimizematerial') return 'optimizeMaterial';
    if (key === 'optimizesemidia' || key === 'optimizesemidiameter') return 'optimizeSemiDia';
    if (key === 'surftype' || key === 'type') return 'surftype';
    if (key === 'radius') return 'radius';
    if (key === 'thickness') return 'thickness';
    if (key === 'material' || key === 'glass') return 'material';
    if (key === 'conic') return 'conic';
    if (key === 'semidia' || key === 'semidiameter' || key === 'semidia(mm)') return 'semidia';
    const m = /^coef(\d+)$/.exec(key);
    if (m) return `coef${m[1]}`;
    return key;
}

function __blocks_parseSurfaceIndexFromRole(role) {
    const m = /^s(\d+)$/.exec(String(role ?? '').trim().toLowerCase());
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n >= 1 ? n : null;
}

function __blocks_findFollowingAirGapBlockId(ownerBlockId) {
    try {
        const activeCfg = getActiveConfiguration();
        const blocks = activeCfg && Array.isArray(activeCfg.blocks) ? activeCfg.blocks : null;
        if (!blocks || blocks.length === 0) return null;

        const id = String(ownerBlockId ?? '').trim().toLowerCase();
        if (!id) return null;
        for (let i = 0; i < blocks.length; i++) {
            const b = blocks[i];
            if (!b || typeof b !== 'object') continue;
            if (String(b.blockId ?? '').trim().toLowerCase() !== id) continue;
            const next = blocks[i + 1];
            if (next && typeof next === 'object') {
                const nt = String(next.blockType ?? '').trim();
                if (nt === 'Gap' || nt === 'AirGap') {
                    const nextId = String(next.blockId ?? '').trim();
                    return nextId || null;
                }
            }
            return null;
        }
        return null;
    } catch (_) {
        return null;
    }
}

function __blocks_autoCreateFollowingAirGap(ownerBlockId, thickness) {
    try {
        console.log(`   [DEBUG] ownerBlockId=${ownerBlockId}, thickness=${thickness}`);
        // IMPORTANT: mutate and persist the same systemConfig instance.
        // If we mutate an activeCfg returned by getActiveConfiguration(), then loadSystemConfigurations() again
        // and save that fresh object, the inserted AirGap will be lost.
        const systemConfig = loadSystemConfigurations();
        const activeCfg = systemConfig && Array.isArray(systemConfig.configurations)
            ? systemConfig.configurations.find(c => c && String(c.id) === String(systemConfig.activeConfigId))
            : null;
        console.log(`   [DEBUG] activeCfg=`, activeCfg ? 'found' : 'null');
        const blocks = activeCfg && Array.isArray(activeCfg.blocks) ? activeCfg.blocks : null;
        console.log(`   [DEBUG] blocks=`, blocks ? `array[${blocks.length}]` : 'null');
        if (!activeCfg || !blocks || blocks.length === 0) {
            console.error('   Cannot auto-create Gap: activeCfg/blocks not found');
            return null;
        }

        // Generate unique Gap ID (legacy: AirGap-*)
        let maxNum = 0;
        for (const b of blocks) {
            if (!b || typeof b !== 'object' || !b.blockId) continue;
            const bt = String(b.blockType ?? '').trim();
            if (!(bt === 'Gap' || bt === 'AirGap')) continue;
            const idRaw = String(b.blockId).trim();
            const m = /^(?:Gap|AirGap)-(\d+)$/i.exec(idRaw);
            if (!m) continue;
            const num = Number(m[1]);
            if (Number.isFinite(num) && num > maxNum) maxNum = num;
        }
        const newGapId = `Gap-${maxNum + 1}`;
        console.log(`   [DEBUG] Generated newGapId=${newGapId}`);

        // Find insertion index
        const id = String(ownerBlockId ?? '').trim().toLowerCase();
        let insertIndex = -1;
        for (let i = 0; i < blocks.length; i++) {
            if (blocks[i] && String(blocks[i].blockId ?? '').trim().toLowerCase() === id) {
                insertIndex = i + 1;
                break;
            }
        }
        console.log(`   [DEBUG] insertIndex=${insertIndex}`);
        if (insertIndex < 0) {
            console.error(`   Cannot auto-create Gap: owner block ${ownerBlockId} not found`);
            return null;
        }

        // Create new Gap block
        const newGap = {
            blockId: newGapId,
            blockType: 'Gap',
            role: null,
            constraints: {},
            parameters: {
                thickness: thickness,
                material: 'AIR'
            },
            variables: {},
            metadata: { source: 'auto-create', after: String(ownerBlockId ?? '') }
        };
        console.log(`   [DEBUG] Created newGap object:`, newGap);

        // Insert into blocks array
        blocks.splice(insertIndex, 0, newGap);
        console.log(`   [DEBUG] Inserted into blocks array at index ${insertIndex}`);

        // Persist to localStorage
        try {
            console.log(`   [DEBUG] Saving systemConfig, configurations.length=${systemConfig?.configurations?.length}`);
            saveSystemConfigurations(systemConfig);
            console.log(`   [DEBUG] Saved systemConfig to localStorage`);
        } catch (err) {
            console.error('   Failed to persist auto-created AirGap to localStorage:', err);
        }

        console.log(`   ✅ Auto-created ${newGapId} with thickness=${thickness} after ${ownerBlockId}`);
        return newGapId;
    } catch (err) {
        console.error('   Error in __blocks_autoCreateFollowingAirGap:', err);
        return null;
    }
}

function formatBlockPreview(block) {
    const b = block && typeof block === 'object' ? block : null;
    if (!b) return '';

    const pick = (key) => {
        const pObj = (b.parameters && typeof b.parameters === 'object') ? b.parameters : null;
        const fromParam = pObj ? pObj[key] : undefined;
        if (fromParam !== undefined && fromParam !== null && String(fromParam).trim() !== '') return fromParam;
        const vObj = (b.variables && typeof b.variables === 'object') ? b.variables : null;
        const fromVar = vObj && vObj[key] && typeof vObj[key] === 'object' ? vObj[key].value : undefined;
        if (fromVar !== undefined && fromVar !== null && String(fromVar).trim() !== '') return fromVar;
        return '';
    };

    const toFiniteNumberOrNull = (v) => {
        if (typeof v === 'number') return Number.isFinite(v) ? v : null;
        const s = String(v ?? '').trim();
        if (s === '') return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
    };

    const normalizeSurfTypeShort = (v) => {
        const s = String(v ?? '').trim();
        if (s === '') return '';
        const key = s.replace(/\s+/g, '').replace(/[_-]+/g, '').toLowerCase();
        if (key === 'spherical') return 'Sph';
        if (key === 'asphericeven' || key === 'asphericaleven') return 'Even';
        if (key === 'asphericodd' || key === 'asphericalodd') return 'Odd';
        return s;
    };

    const summarizeAsphere = (surfTypeKey, conicKey, coefPrefix) => {
        const st = pick(surfTypeKey);
        const conic = pick(conicKey);
        const conicN = toFiniteNumberOrNull(conic);

        /** @type {number[]} */
        const nz = [];
        for (let i = 1; i <= 10; i++) {
            const v = pick(`${coefPrefix}${i}`);
            const n = toFiniteNumberOrNull(v);
            if (n !== null && Math.abs(n) > 0) nz.push(i);
        }

        const stShort = normalizeSurfTypeShort(st);
        const isNonSpherical = stShort && stShort !== 'Sph';
        const hasConic = conicN !== null && Math.abs(conicN) > 0;
        const hasCoefs = nz.length > 0;
        if (!isNonSpherical && !hasConic && !hasCoefs) return '';

        const parts = [];
        if (stShort) parts.push(`ST=${stShort}`);
        if (hasConic) parts.push(`K=${String(conic)}`);
        if (hasCoefs) parts.push(`coefNZ=${nz.length}(${nz.join(',')})`);
        return parts.join(' ');
    };

    const type = String(b.blockType ?? '');
    if (type === 'Lens' || type === 'PositiveLens') {
        const r1 = pick('frontRadius');
        const r2 = pick('backRadius');
        const ct = pick('centerThickness');
        const mat = pick('material');

        const frontAs = summarizeAsphere('frontSurfType', 'frontConic', 'frontCoef');
        const backAs = summarizeAsphere('backSurfType', 'backConic', 'backCoef');

        const parts = [];
        if (String(r1) !== '') parts.push(`R1=${String(r1)}`);
        if (String(r2) !== '') parts.push(`R2=${String(r2)}`);
        if (String(ct) !== '') parts.push(`CT=${String(ct)}`);
        if (String(mat) !== '') parts.push(`G=${String(mat)}`);
        if (frontAs) parts.push(`F[${frontAs}]`);
        if (backAs) parts.push(`B[${backAs}]`);
        return parts.join(' ');
    }

    if (type === 'Doublet' || type === 'Triplet') {
        const elemCount = (type === 'Doublet') ? 2 : 3;
        const surfCount = elemCount + 1;
        const parts = [];

        /** @type {string[]} */
        const r = [];
        for (let si = 1; si <= surfCount; si++) {
            const v = pick(`radius${si}`);
            if (String(v) !== '') r.push(String(v));
        }
        if (r.length > 0) parts.push(`R=[${r.join(',')}]`);

        /** @type {string[]} */
        const t = [];
        /** @type {string[]} */
        const m = [];
        for (let ei = 1; ei <= elemCount; ei++) {
            const tv = pick(`thickness${ei}`);
            const mv = pick(`material${ei}`);
            if (String(tv) !== '') t.push(String(tv));
            if (String(mv) !== '') m.push(String(mv));
        }
        if (t.length > 0) parts.push(`T=[${t.join(',')}]`);
        if (m.length > 0) parts.push(`G=[${m.join(',')}]`);

        /** @type {string[]} */
        const as = [];
        for (let si = 1; si <= surfCount; si++) {
            const a = summarizeAsphere(`surf${si}SurfType`, `surf${si}Conic`, `surf${si}Coef`);
            if (a) as.push(`${si}:${a}`);
        }
        if (as.length > 0) parts.push(`Asph{${as.join(' | ')}}`);
        return parts.join(' ');
    }

    if (type === 'Gap' || type === 'AirGap') {
        const th = pick('thickness');
        const mat = pick('material');
        const parts = [];
        if (String(th) !== '') parts.push(`T=${String(th)}`);
        if (String(mat) !== '' && String(mat).trim().toUpperCase() !== 'AIR') parts.push(`M=${String(mat)}`);
        return parts.join(' ');
    }

    if (type === 'ObjectPlane') {
        const modeRaw = pick('objectDistanceMode');
        const mode = String(modeRaw ?? '').trim().replace(/\s+/g, '').toUpperCase();
        if (mode === 'INF' || mode === 'INFINITY') return 'INF';
        const d = pick('objectDistance');
        return String(d) !== '' ? `D=${String(d)}` : '';
    }

    if (type === 'Stop') {
        const sd = pick('semiDiameter');
        return String(sd) !== '' ? `SD=${String(sd)}` : '';
    }

    return '';
}

let __blockInspectorExpandedBlockId = null;

// Remembers which material key (material/material1/material2/...) the user last interacted with
// for each expanded blockId, so the toolbar "Find Glass" targets the correct field.
const __blockInspectorPreferredMaterialKeyByBlockId = new Map();

let __blocks_lastScopeErrors = [];

function __blocks_generateUniqueBlockId(blocks, baseType) {
    const base = String(baseType ?? '').trim();
    if (!Array.isArray(blocks) || !base) return `${base}-1`;
    let maxNum = 0;
    const re = new RegExp(`^${base.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}-(\\d+)$`, 'i');
    for (const b of blocks) {
        const id = b && typeof b === 'object' ? String(b.blockId ?? '').trim() : '';
        const m = re.exec(id);
        if (m) {
            const n = Number(m[1]);
            if (Number.isFinite(n) && n > maxNum) maxNum = n;
        }
    }
    return `${base}-${maxNum + 1}`;
}

function __blocks_makeDefaultBlock(blockType, blockId) {
    const type = String(blockType ?? '').trim();
    const id = String(blockId ?? '').trim();
    const base = {
        blockId: id,
        blockType: type,
        role: null,
        constraints: {},
        parameters: {},
        variables: {},
        metadata: { source: 'ui-add' }
    };

    if (type === 'Lens' || type === 'PositiveLens') {
        base.parameters = {
            frontRadius: 'INF',
            backRadius: 'INF',
            centerThickness: 1,
            material: 'N-BK7'
        };
        return base;
    }
    if (type === 'Doublet') {
        base.parameters = {
            radius1: 'INF',
            radius2: 'INF',
            radius3: 'INF',
            thickness1: 1,
            thickness2: 1,
            material1: 'N-BK7',
            material2: 'N-F2'
        };
        return base;
    }
    if (type === 'Triplet') {
        base.parameters = {
            radius1: 'INF',
            radius2: 'INF',
            radius3: 'INF',
            radius4: 'INF',
            thickness1: 1,
            thickness2: 1,
            thickness3: 1,
            material1: 'N-BK7',
            material2: 'N-F2',
            material3: 'N-BK7'
        };
        return base;
    }
    if (type === 'Gap' || type === 'AirGap') {
        base.blockType = 'Gap';
        base.parameters = { thickness: 1, material: 'AIR' };
        return base;
    }
    if (type === 'ObjectPlane') {
        base.parameters = {
            objectDistanceMode: 'Finite',
            objectDistance: 100
        };
        return base;
    }
    if (type === 'Stop') {
        base.parameters = { semiDiameter: DEFAULT_STOP_SEMI_DIAMETER };
        return base;
    }
    if (type === 'ImagePlane') {
        // Marker block: no parameters/variables required.
        delete base.parameters;
        delete base.variables;
        return base;
    }

    // Fallback: keep empty parameters to satisfy validation rule for non-ImagePlane.
    base.parameters = {};
    return base;
}

function __blocks_addBlockToActiveConfig(blockType, insertAfterBlockId = null) {
    const systemConfig = (typeof loadSystemConfigurations === 'function') ? loadSystemConfigurations() : null;
    if (!systemConfig || !Array.isArray(systemConfig.configurations)) return { ok: false, reason: 'systemConfigurations not found.' };

    const activeId = systemConfig.activeConfigId;
    const cfgIdx = systemConfig.configurations.findIndex(c => c && c.id === activeId);
    if (cfgIdx < 0) return { ok: false, reason: 'active config not found.' };

    const activeCfg = systemConfig.configurations[cfgIdx];
    if (!activeCfg || !Array.isArray(activeCfg.blocks)) return { ok: false, reason: 'active config has no blocks.' };
    const blocks = activeCfg.blocks;

    const type = String(blockType ?? '').trim();
    if (!type) return { ok: false, reason: 'blockType is required.' };

    if (type === 'ImagePlane') {
        const already = blocks.some(b => b && String(b.blockType ?? '').trim() === 'ImagePlane');
        if (already) return { ok: false, reason: 'ImagePlane already exists (only one is supported).' };
    }

    if (type === 'ObjectPlane') {
        const already = blocks.some(b => b && String(b.blockType ?? '').trim() === 'ObjectPlane');
        if (already) return { ok: false, reason: 'ObjectPlane already exists (only one is supported).' };
    }

    const newId = __blocks_generateUniqueBlockId(blocks, type);
    const newBlock = __blocks_makeDefaultBlock(type, newId);

    // Insert position: after selected block, but never after ImagePlane.
    let imageIdx = blocks.findIndex(b => b && String(b.blockType ?? '').trim() === 'ImagePlane');
    if (imageIdx < 0) imageIdx = blocks.length;

    let insertIdx = imageIdx; // default: before ImagePlane (or end)

    // ObjectPlane defines the object-to-first-surface distance; keep it first since there is no reorder UI.
    if (type === 'ObjectPlane') {
        insertIdx = 0;
    }
    const afterId = String(insertAfterBlockId ?? '').trim();
    if (afterId) {
        const idx = blocks.findIndex(b => b && String(b.blockId ?? '').trim() === afterId);
        if (idx >= 0) insertIdx = Math.min(idx + 1, imageIdx);
    }

    blocks.splice(insertIdx, 0, newBlock);

    try {
        if (!activeCfg.metadata || typeof activeCfg.metadata !== 'object') activeCfg.metadata = {};
        activeCfg.metadata.modified = new Date().toISOString();
    } catch (_) {}

    // Validate whole config; if fatal, rollback.
    try {
        const issues = validateBlocksConfiguration(activeCfg);
        const fatals = issues.filter(i => i && i.severity === 'fatal');
        if (fatals.length > 0) {
            blocks.splice(insertIdx, 1);
            try { showLoadErrors(issues, { filename: '(active config)' }); } catch (_) {}
            return { ok: false, reason: 'block validation failed.' };
        }
    } catch (_) {
        // ignore
    }

    try {
        if (typeof saveSystemConfigurations === 'function') {
            saveSystemConfigurations(systemConfig);
        } else if (typeof localStorage !== 'undefined') {
            localStorage.setItem('systemConfigurations', JSON.stringify(systemConfig));
        }
    } catch (e) {
        return { ok: false, reason: `failed to save: ${e?.message || String(e)}` };
    }

    return { ok: true, blockId: newId };
}

function __blocks_deleteBlockFromActiveConfig(blockId) {
    const systemConfig = (typeof loadSystemConfigurations === 'function') ? loadSystemConfigurations() : null;
    if (!systemConfig || !Array.isArray(systemConfig.configurations)) return { ok: false, reason: 'systemConfigurations not found.' };

    const activeId = systemConfig.activeConfigId;
    const cfgIdx = systemConfig.configurations.findIndex(c => c && c.id === activeId);
    if (cfgIdx < 0) return { ok: false, reason: 'active config not found.' };

    const activeCfg = systemConfig.configurations[cfgIdx];
    if (!activeCfg || !Array.isArray(activeCfg.blocks)) return { ok: false, reason: 'active config has no blocks.' };
    const blocks = activeCfg.blocks;

    const id = String(blockId ?? '').trim();
    if (!id) return { ok: false, reason: 'blockId is required.' };

    const idx = blocks.findIndex(b => b && String(b.blockId ?? '').trim() === id);
    if (idx < 0) return { ok: false, reason: `block not found: ${id}` };

    const type = String(blocks[idx]?.blockType ?? '').trim();
    if (type === 'ImagePlane') return { ok: false, reason: 'ImagePlane cannot be deleted.' };

    const removed = blocks.splice(idx, 1);

    try {
        if (!activeCfg.metadata || typeof activeCfg.metadata !== 'object') activeCfg.metadata = {};
        activeCfg.metadata.modified = new Date().toISOString();
    } catch (_) {}

    // Validate whole config; if fatal, rollback.
    try {
        const issues = validateBlocksConfiguration(activeCfg);
        const fatals = issues.filter(i => i && i.severity === 'fatal');
        if (fatals.length > 0) {
            blocks.splice(idx, 0, ...(removed || []));
            try { showLoadErrors(issues, { filename: '(active config)' }); } catch (_) {}
            return { ok: false, reason: 'block validation failed.' };
        }
    } catch (_) {
        // ignore
    }

    try {
        if (typeof saveSystemConfigurations === 'function') {
            saveSystemConfigurations(systemConfig);
        } else if (typeof localStorage !== 'undefined') {
            localStorage.setItem('systemConfigurations', JSON.stringify(systemConfig));
        }
    } catch (e) {
        return { ok: false, reason: `failed to save: ${e?.message || String(e)}` };
    }

    return { ok: true };
}

function __blocks_setExpandedOpticalSystemUIVisible(visible) {
    try {
        const header = document.querySelector('.expanded-optical-system-header');
        const content = document.getElementById('expanded-optical-system-content');
        if (header) header.style.display = visible ? '' : 'none';
        if (content) content.style.display = visible ? '' : 'none';
    } catch (_) {}
}

function __blocks_coerceParamValue(blockType, key, raw) {
    const s = String(raw ?? '').trim();

    // Allow blank to mean "unset" for optional fields.
    if (s === '') return '';

    // Common tokens
    if (/^inf(inity)?$/i.test(s)) return 'INF';
    if (/^(a|auto|u)$/i.test(s)) return 'AUTO';

    // Materials and surf types are strings
    if (/^material\d*$/i.test(key) || /^material$/i.test(key)) return s;
    if (/surftype$/i.test(key)) return s;

    // Numeric: parse when possible
    const n = Number(s);
    if (Number.isFinite(n)) return n;
    return s;
}

function __blocks_setBlockParamValue(blockId, key, rawValue) {
    const systemConfig = (typeof loadSystemConfigurations === 'function') ? loadSystemConfigurations() : null;
    if (!systemConfig || !Array.isArray(systemConfig.configurations)) return { ok: false, reason: 'systemConfigurations not found.' };

    const activeId = systemConfig.activeConfigId;
    const cfgIdx = systemConfig.configurations.findIndex(c => c && c.id === activeId);
    if (cfgIdx < 0) return { ok: false, reason: 'active config not found.' };

    const activeCfg = systemConfig.configurations[cfgIdx];
    if (!activeCfg || !Array.isArray(activeCfg.blocks)) return { ok: false, reason: 'active config has no blocks.' };

    const b = activeCfg.blocks.find(x => x && String(x.blockId ?? '') === String(blockId));
    if (!b) return { ok: false, reason: `block not found: ${String(blockId)}` };

    if (!b.parameters || typeof b.parameters !== 'object') b.parameters = {};

    const coerced = __blocks_coerceParamValue(String(b.blockType ?? ''), String(key ?? ''), rawValue);
    b.parameters[String(key)] = coerced;

    // Basic validation: don't persist obviously invalid Stop.semiDiameter
    if (String(b.blockType ?? '') === 'Stop' && String(key) === 'semiDiameter') {
        const n = (typeof coerced === 'number') ? coerced : Number(String(coerced ?? '').trim());
        if (!Number.isFinite(n) || n <= 0) {
            return { ok: false, reason: `Stop.semiDiameter must be positive: ${String(rawValue)}` };
        }
    }

    // Validate whole config; if fatal, abort.
    try {
        const issues = validateBlocksConfiguration(activeCfg);
        const fatals = issues.filter(i => i && i.severity === 'fatal');
        if (fatals.length > 0) {
            try { showLoadErrors(issues, { filename: '(active config)' }); } catch (_) {}
            return { ok: false, reason: 'block validation failed.' };
        }
    } catch (_) {
        // If validation throws, still attempt to save the edit.
    }

    try {
        if (!activeCfg.metadata || typeof activeCfg.metadata !== 'object') activeCfg.metadata = {};
        activeCfg.metadata.modified = new Date().toISOString();
    } catch (_) {}

    try {
        if (typeof saveSystemConfigurations === 'function') {
            saveSystemConfigurations(systemConfig);
        } else if (typeof localStorage !== 'undefined') {
            localStorage.setItem('systemConfigurations', JSON.stringify(systemConfig));
        }
    } catch (e) {
        return { ok: false, reason: `failed to save: ${e?.message || String(e)}` };
    }

    return { ok: true };
}

function __blocks_coerceApertureValue(raw) {
    const s = String(raw ?? '').trim();

    // Blank means unset.
    if (s === '') return '';

    // Allow AUTO/Auto as a special token (meaning: no semidia limit).
    if (/^(a|auto|u)$/i.test(s)) return 'AUTO';

    const n = Number(s);
    if (!Number.isFinite(n)) return s;
    if (n <= 0) return '';
    return n;
}

function __blocks_setBlockApertureValue(blockId, role, rawValue) {
    const systemConfig = (typeof loadSystemConfigurations === 'function') ? loadSystemConfigurations() : null;
    if (!systemConfig || !Array.isArray(systemConfig.configurations)) return { ok: false, reason: 'systemConfigurations not found.' };

    const activeId = systemConfig.activeConfigId;
    const cfgIdx = systemConfig.configurations.findIndex(c => c && c.id === activeId);
    if (cfgIdx < 0) return { ok: false, reason: 'active config not found.' };

    const activeCfg = systemConfig.configurations[cfgIdx];
    if (!activeCfg || !Array.isArray(activeCfg.blocks)) return { ok: false, reason: 'active config has no blocks.' };

    const b = activeCfg.blocks.find(x => x && String(x.blockId ?? '') === String(blockId));
    if (!b) return { ok: false, reason: `block not found: ${String(blockId)}` };

    if (!b.aperture || typeof b.aperture !== 'object') b.aperture = {};
    const r = String(role ?? '').trim();
    if (!r) return { ok: false, reason: 'role is required.' };

    const coerced = __blocks_coerceApertureValue(rawValue);
    if (String(coerced ?? '').trim() === '') {
        // Unset
        try { delete b.aperture[r]; } catch (_) { b.aperture[r] = ''; }
    } else {
        b.aperture[r] = coerced;
    }

    // Validate whole config; if fatal, abort.
    try {
        const issues = validateBlocksConfiguration(activeCfg);
        const fatals = issues.filter(i => i && i.severity === 'fatal');
        if (fatals.length > 0) {
            try { showLoadErrors(issues, { filename: '(active config)' }); } catch (_) {}
            return { ok: false, reason: 'block validation failed.' };
        }
    } catch (_) {
        // ignore
    }

    try {
        if (!activeCfg.metadata || typeof activeCfg.metadata !== 'object') activeCfg.metadata = {};
        activeCfg.metadata.modified = new Date().toISOString();
    } catch (_) {}

    try {
        if (typeof saveSystemConfigurations === 'function') {
            saveSystemConfigurations(systemConfig);
        } else if (typeof localStorage !== 'undefined') {
            localStorage.setItem('systemConfigurations', JSON.stringify(systemConfig));
        }
    } catch (e) {
        return { ok: false, reason: `failed to save: ${e?.message || String(e)}` };
    }

    return { ok: true };
}

function __blocks_shouldMarkVar(v) {
    if (!v || typeof v !== 'object') return false;
    const mode = v?.optimize?.mode;
    return mode === 'V' || mode === true;
}

function __blocks_getVarScope(v) {
    try {
        const s = String(v?.optimize?.scope ?? '').trim();
        if (s === 'global' || s === 'shared') return 'global';
        if (s === 'perConfig' || s === 'local' || s === 'per-config') return 'perConfig';
    } catch (_) {}
    return 'perConfig';
}

function __blocks_setVarScope(blockId, key, scope) {
    try {
        const systemConfig = (typeof loadSystemConfigurations === 'function') ? loadSystemConfigurations() : null;
        if (!systemConfig || !Array.isArray(systemConfig.configurations)) return;

        const activeId = systemConfig.activeConfigId;
        const cfgIdx = systemConfig.configurations.findIndex(c => c && c.id === activeId);
        if (cfgIdx < 0) return;

        const activeCfg = systemConfig.configurations[cfgIdx];
        if (!activeCfg || !Array.isArray(activeCfg.blocks)) return;

        const b = activeCfg.blocks.find(x => x && String(x.blockId ?? '') === String(blockId));
        if (!b) return;

        if (!b.variables || typeof b.variables !== 'object') b.variables = {};
        if (!b.variables[key] || typeof b.variables[key] !== 'object') b.variables[key] = { value: b.parameters?.[key] ?? '' };
        if (!b.variables[key].optimize || typeof b.variables[key].optimize !== 'object') b.variables[key].optimize = {};
        b.variables[key].optimize.scope = (scope === 'global') ? 'global' : 'perConfig';

        try {
            if (typeof saveSystemConfigurations === 'function') {
                saveSystemConfigurations(systemConfig);
            } else if (typeof localStorage !== 'undefined') {
                localStorage.setItem('systemConfigurations', JSON.stringify(systemConfig));
            }
        } catch (_) {}
    } catch (_) {}
}

function __blocks_setVarMode(blockId, key, enabled, scope = 'perConfig') {
    try {
        const systemConfig = (typeof loadSystemConfigurations === 'function') ? loadSystemConfigurations() : null;
        if (!systemConfig || !Array.isArray(systemConfig.configurations)) return;

        /** @type {Array<{configId:string, configName?:string}>} */
        const missing = [];

        const activeId = systemConfig.activeConfigId;
        const targets = (scope === 'global')
            ? (systemConfig.configurations || [])
            : [systemConfig.configurations.find(c => c && c.id === activeId) || systemConfig.configurations[0]];

        for (const cfg of targets) {
            if (!cfg || !Array.isArray(cfg.blocks)) {
                missing.push({ configId: String(cfg?.id ?? '(none)'), configName: cfg?.name });
                continue;
            }
            const b = cfg.blocks.find(x => x && String(x.blockId ?? '') === String(blockId));
            if (!b) {
                missing.push({ configId: String(cfg?.id ?? '(none)'), configName: cfg?.name });
                continue;
            }

            if (!b.variables || typeof b.variables !== 'object') b.variables = {};
            if (!b.variables[key] || typeof b.variables[key] !== 'object') b.variables[key] = { value: b.parameters?.[key] ?? '' };
            if (!b.variables[key].optimize || typeof b.variables[key].optimize !== 'object') b.variables[key].optimize = {};
            b.variables[key].optimize.mode = enabled ? 'V' : 'F';
            b.variables[key].optimize.scope = (scope === 'global') ? 'global' : 'perConfig';
        }

        __blocks_lastScopeErrors = missing.length > 0
            ? [{
                blockId: String(blockId),
                key: String(key),
                scope: String(scope),
                missing
            }]
            : [];

        try {
            if (typeof saveSystemConfigurations === 'function') {
                saveSystemConfigurations(systemConfig);
            } else if (typeof localStorage !== 'undefined') {
                localStorage.setItem('systemConfigurations', JSON.stringify(systemConfig));
            }
        } catch (_) {}
    } catch (_) {}
}

function renderBlockInspector(summary, groups, blockById = null, blocksInOrder = null) {
    const container = document.getElementById('block-inspector');
    if (!container) return;

    container.innerHTML = '';

    try {
        if (Array.isArray(__blocks_lastScopeErrors) && __blocks_lastScopeErrors.length > 0) {
            const e0 = __blocks_lastScopeErrors[0];
            const miss = Array.isArray(e0?.missing) ? e0.missing : [];
            const names = miss.slice(0, 6).map(m => m?.configName ? `${String(m.configName)}(${String(m.configId)})` : String(m?.configId ?? '')).filter(Boolean);
            const banner = document.createElement('div');
            banner.style.padding = '8px 10px';
            banner.style.margin = '6px 0 10px 0';
            banner.style.border = '1px solid #f2c2c2';
            banner.style.background = '#fff5f5';
            banner.style.color = '#8a1f1f';
            banner.style.borderRadius = '6px';
            banner.style.fontSize = '12px';
            banner.textContent = `ERROR: Cannot apply “Shared (all configs)” because this Block is missing in some configurations: ${String(e0?.blockId ?? '')}.${String(e0?.key ?? '')} / missing in ${miss.length} config(s): ${names.join(', ')}${miss.length > names.length ? ', ...' : ''}`;
            container.appendChild(banner);
        }
    } catch (_) {}
    const list = Array.isArray(summary) ? summary : [];
    if (list.length === 0) {
        const empty = document.createElement('div');
        empty.style.padding = '8px';
        empty.style.fontSize = '13px';
        empty.style.color = '#666';
        empty.textContent = 'No blocks (or no provenance).';
        container.appendChild(empty);
        return;
    }

    // Compute per-block surface index ranges from the expanded Optical System.
    // Requirements operands that accept S1/S2 refer to these surface numbers.
    /** @type {Map<string, {min:number, max:number}>} */
    const surfRangeByBlockId = new Map();
    try {
        if (Array.isArray(blocksInOrder) && blocksInOrder.length > 0 && typeof expandBlocksToOpticalSystemRows === 'function') {
            const exp = expandBlocksToOpticalSystemRows(blocksInOrder);
            const rows = exp && Array.isArray(exp.rows) ? exp.rows : [];
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                const bid = String(r?._blockId ?? '').trim();
                if (!bid) continue;
                // Surface numbering convention here: Surf 0 = Object (row 0), then surfaces follow.
                // So expanded row index i maps directly to Surf i.
                const surfNo = i;
                const prev = surfRangeByBlockId.get(bid);
                if (!prev) surfRangeByBlockId.set(bid, { min: surfNo, max: surfNo });
                else {
                    if (surfNo < prev.min) prev.min = surfNo;
                    if (surfNo > prev.max) prev.max = surfNo;
                }
            }
        }
    } catch (_) {
        // ignore
    }

    const formatSingletonBlockLabel = (blockType, blockIdRaw) => {
        const t = String(blockType ?? '').trim();
        const id = String(blockIdRaw ?? '').trim();
        if (t === 'ObjectPlane' || t === 'ImagePlane') return t;
        const m = /^(ObjectPlane|ImagePlane)-\d+$/i.exec(id);
        if (m) return m[1];
        return id || '(none)';
    };

    // UI display label mapping: keep internal blockId stable for references,
    // but show human-friendly sequential names in the block list.
    /** @type {Map<string, string>} */
    const displayLabelByBlockId = new Map();
    try {
        const counts = new Map();
        const blocks = Array.isArray(blocksInOrder) ? blocksInOrder : [];
        for (const bb of blocks) {
            if (!bb || typeof bb !== 'object') continue;
            const realId = String(bb.blockId ?? '').trim();
            if (!realId) continue;
            const tRaw = String(bb.blockType ?? '').trim();
            if (!tRaw) continue;

            // Singletons: show without numbering.
            if (tRaw === 'ObjectPlane' || tRaw === 'ImagePlane') {
                displayLabelByBlockId.set(realId, tRaw);
                continue;
            }

            // Normalize display base type.
            const baseType = (tRaw === 'PositiveLens') ? 'Lens' : tRaw;
            const next = (counts.get(baseType) || 0) + 1;
            counts.set(baseType, next);
            displayLabelByBlockId.set(realId, `${baseType}-${next}`);
        }
    } catch (_) {}

    // Blocks-only toolbar: add a new block to the active configuration.
    for (const b of list) {
        const row = document.createElement('div');
        row.className = 'block-inspector-row';

        const colId = document.createElement('div');
        colId.className = 'block-inspector-col-id';
        {
            const rawId = String(b.blockId ?? '(none)');
            const label = displayLabelByBlockId.get(rawId) || formatSingletonBlockLabel(b.blockType, rawId);

            // Special-case: ObjectPlane corresponds to the Object surface (Surf 0).
            if (String(b.blockType ?? '').trim() === 'ObjectPlane') {
                colId.textContent = `${label} → Surf 0`;
            } else {
                const range = surfRangeByBlockId.get(String(b.blockId ?? '').trim());
                if (range && Number.isFinite(range.min) && Number.isFinite(range.max)) {
                    const surfText = (range.min === range.max)
                        ? `Surf ${range.min}`
                        : `Surf ${range.min}–${range.max}`;
                    colId.textContent = `${label} → ${surfText}`;
                } else {
                    colId.textContent = label;
                }
            }
        }

        const colType = document.createElement('div');
        colType.className = 'block-inspector-col-type';
        colType.textContent = String(b.blockType ?? '(none)');

        const colParams = document.createElement('div');
        colParams.className = 'block-inspector-col-params';
        colParams.textContent = String(b.preview ?? '');

        const colCount = document.createElement('div');
        colCount.className = 'block-inspector-col-count';
        {
            const n = Number(b.surfaceCount ?? 0);
            colCount.textContent = `→ ${Number.isFinite(n) ? n : 0} surfaces`;
        }

        row.appendChild(colId);
        row.appendChild(colType);
        row.appendChild(colParams);
        row.appendChild(colCount);

        row.onclick = () => {
            const blockId = String(b.blockId ?? '').trim();
            if (!blockId) return;
            __blockInspectorExpandedBlockId = (__blockInspectorExpandedBlockId === blockId) ? null : blockId;
            try { refreshBlockInspector(); } catch (_) {}
        };

        container.appendChild(row);

        const blockId = String(b.blockId ?? '');
        const blockType = String(b.blockType ?? '');
        const realBlock = blockById && typeof blockById.get === 'function' ? blockById.get(blockId) : null;
        if (realBlock && __blockInspectorExpandedBlockId === blockId) {
            const panel = document.createElement('div');
            panel.style.padding = '6px 8px 10px 8px';
            panel.style.borderTop = '1px solid #eee';
            panel.style.fontSize = '12px';
            panel.style.color = '#333';

            /** @type {Array<{key:string,label:string}>} */
            const items = [];

            const vars = realBlock.variables && typeof realBlock.variables === 'object' ? realBlock.variables : {};
            const params = realBlock.parameters && typeof realBlock.parameters === 'object' ? realBlock.parameters : {};

            // Precompute expanded semidia by provenance so the inspector can show
            // per-surface semidia even if not explicitly stored in block.aperture.
            /** @type {Map<string, any>} */
            const semidiaByProv = new Map();
            try {
                if (Array.isArray(blocksInOrder) && blocksInOrder.length > 0 && typeof expandBlocksToOpticalSystemRows === 'function') {
                    const exp = expandBlocksToOpticalSystemRows(blocksInOrder);
                    const rows = exp && Array.isArray(exp.rows) ? exp.rows : [];
                    for (const r of rows) {
                        const bid = String(r?._blockId ?? '').trim();
                        const role = String(r?._surfaceRole ?? '').trim();
                        if (!bid || !role) continue;
                        const key = `p:${bid}|${role}`;
                        if (!semidiaByProv.has(key)) semidiaByProv.set(key, r?.semidia);
                    }
                }
            } catch (_) {}

            const getApertureDisplayValue = (role) => {
                try {
                    const ap = (realBlock.aperture && typeof realBlock.aperture === 'object') ? realBlock.aperture : null;
                    const r = String(role ?? '').trim();
                    if (ap && Object.prototype.hasOwnProperty.call(ap, r)) {
                        const v = ap[r];
                        const s = String(v ?? '').trim();
                        if (s !== '') return s;
                    }
                    const key = `p:${String(blockId).trim()}|${r}`;
                    const v2 = semidiaByProv.get(key);
                    return String(v2 ?? '');
                } catch (_) {
                    return '';
                }
            };

            const getValue = (k) => {
                if (Object.prototype.hasOwnProperty.call(params, k)) return params[k];
                if (vars[k] && typeof vars[k] === 'object' && Object.prototype.hasOwnProperty.call(vars[k], 'value')) return vars[k].value;
                return '';
            };

            const getDisplayValue = (k) => {
                const v = getValue(k);
                // Show a meaningful default for Stop.semiDiameter when omitted.
                if (blockType === 'Stop' && String(k) === 'semiDiameter') {
                    const s = String(v ?? '').trim();
                    if (s === '') return String(DEFAULT_STOP_SEMI_DIAMETER);
                }
                return String(v ?? '');
            };

            const isSphericalSurfType = (v) => {
                const s = String(v ?? '').trim();
                if (s === '') return true;
                const key = s.replace(/\s+/g, '').replace(/[_-]+/g, '').toLowerCase();
                return key === 'spherical' || key === 'sph';
            };

            const shouldShowCoefsForSurfTypeKey = (surfTypeKey) => {
                const st = getValue(surfTypeKey);
                return !isSphericalSurfType(st);
            };

            if (blockType === 'ObjectPlane') {
                items.push(
                    { kind: 'objectMode', key: 'objectDistanceMode', label: 'object (INF/finite)', noOptimize: true },
                    { kind: 'objectDistance', key: 'objectDistance', label: 'distance to 1st lens', noOptimize: true }
                );
            } else if (blockType === 'Lens' || blockType === 'PositiveLens') {
                items.push(
                    { kind: 'aperture', role: 'front', label: 'semidia(front)' },
                    { kind: 'aperture', role: 'back', label: 'semidia(back)' },
                    { key: 'frontRadius', label: 'frontRadius' },
                    { key: 'backRadius', label: 'backRadius' },
                    { key: 'centerThickness', label: 'centerThickness' },
                    { key: 'material', label: 'material' },
                    { key: 'frontSurfType', label: 'frontSurfType' },
                    { key: 'backSurfType', label: 'backSurfType' },
                    { key: 'frontConic', label: 'frontConic' },
                    { key: 'backConic', label: 'backConic' }
                );

                // Coef* is unused for Spherical. Hide to keep Design Intent concise.
                if (shouldShowCoefsForSurfTypeKey('frontSurfType')) {
                    for (let i = 1; i <= 10; i++) items.push({ key: `frontCoef${i}`, label: `frontCoef${i}` });
                }
                if (shouldShowCoefsForSurfTypeKey('backSurfType')) {
                    for (let i = 1; i <= 10; i++) items.push({ key: `backCoef${i}`, label: `backCoef${i}` });
                }
            } else if (blockType === 'Doublet' || blockType === 'Triplet') {
                const elemCount = (blockType === 'Doublet') ? 2 : 3;
                const surfCount = elemCount + 1;

                for (let si = 1; si <= surfCount; si++) items.push({ kind: 'aperture', role: `s${si}`, label: `semidia(s${si})` });
                for (let si = 1; si <= surfCount; si++) items.push({ key: `radius${si}`, label: `radius${si}` });
                for (let ei = 1; ei <= elemCount; ei++) {
                    items.push({ key: `thickness${ei}`, label: `thickness${ei}` });
                    items.push({ key: `material${ei}`, label: `material${ei}` });
                }
                for (let si = 1; si <= surfCount; si++) {
                    items.push({ key: `surf${si}SurfType`, label: `surf${si}SurfType` });
                    items.push({ key: `surf${si}Conic`, label: `surf${si}Conic` });

                    // Coef* is unused for Spherical. Hide per-surface.
                    if (shouldShowCoefsForSurfTypeKey(`surf${si}SurfType`)) {
                        for (let k = 1; k <= 10; k++) items.push({ key: `surf${si}Coef${k}`, label: `surf${si}Coef${k}` });
                    }
                }
            } else if (blockType === 'Gap' || blockType === 'AirGap') {
                items.push({ key: 'thickness', label: 'thickness' });
                items.push({ key: 'material', label: 'material' });
            } else if (blockType === 'Stop') {
                // UX alias: the surface table uses "semidia"; Blocks store it as Stop.parameters.semiDiameter.
                items.push({ key: 'semiDiameter', label: 'semidia' });
            }
            for (const it of items) {
                const isApertureItem = it && typeof it === 'object' && String(it.kind ?? '') === 'aperture';
                const isObjectModeItem = !isApertureItem && it && typeof it === 'object' && String(it.kind ?? '') === 'objectMode';
                const isObjectDistanceItem = !isApertureItem && it && typeof it === 'object' && String(it.kind ?? '') === 'objectDistance';
                const isSurfTypeItem = !isApertureItem && it && typeof it === 'object' && typeof it.key === 'string' && /surftype$/i.test(String(it.key));
                const isMaterialItem = !isApertureItem && it && typeof it === 'object' && typeof it.key === 'string' && /^material\d*$/i.test(String(it.key));
                const allowOptimize = !isApertureItem && !(it && typeof it === 'object' && it.noOptimize);
                const line = document.createElement('div');
                line.style.display = 'flex';
                line.style.alignItems = 'center';
                line.style.gap = '8px';
                line.style.padding = '2px 0';

                if (isMaterialItem) {
                    // Clicking the row (not only the input) should make toolbar "Find Glass" target this key.
                    line.addEventListener('click', (e) => {
                        try { e?.stopPropagation?.(); } catch (_) {}
                        try {
                            const mk = String(it?.key ?? '').trim();
                            if (mk) __blockInspectorPreferredMaterialKeyByBlockId.set(String(blockId), mk);
                        } catch (_) {}
                    });
                }

                let scopeSel = null;
                let cb = null;
                if (allowOptimize) {
                    scopeSel = document.createElement('select');
                    scopeSel.style.flex = '0 0 auto';
                    scopeSel.style.fontSize = '12px';
                    scopeSel.style.padding = '2px 4px';
                    scopeSel.innerHTML = '<option value="perConfig">Per-config</option><option value="global">Shared (all configs)</option>';
                    scopeSel.value = __blocks_getVarScope(vars[it.key]);

                    cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.checked = __blocks_shouldMarkVar(vars[it.key]);
                    cb.addEventListener('click', (e) => e.stopPropagation());
                    cb.addEventListener('change', (e) => {
                        e.stopPropagation();
                        try { scopeSel.disabled = !cb.checked; } catch (_) {}
                        __blocks_setVarMode(blockId, it.key, cb.checked, String(scopeSel.value));
                        try { refreshBlockInspector(); } catch (_) {}
                    });
                    scopeSel.disabled = !cb.checked;
                    scopeSel.addEventListener('click', (e) => e.stopPropagation());
                    scopeSel.addEventListener('change', (e) => {
                        e.stopPropagation();
                        const newScope = String(scopeSel.value);
                        __blocks_setVarScope(blockId, it.key, newScope);
                        // If already variable, re-apply mode with the new scope.
                        if (cb.checked) {
                            __blocks_setVarMode(blockId, it.key, true, newScope);
                        }
                        try { refreshBlockInspector(); } catch (_) {}
                    });
                }

                const name = document.createElement('div');
                name.textContent = it.label;
                name.style.flex = '1 1 auto';
                name.style.fontFamily = 'monospace';

                // Editable value (Design Intent canonical edits)
                const currentValue = isApertureItem ? getApertureDisplayValue(it.role) : getDisplayValue(it.key);

                const commitValue = (nextRaw) => {
                    const next = String(nextRaw ?? '');
                    const current = currentValue;
                    if (next === current) return;
                    const res = isApertureItem
                        ? __blocks_setBlockApertureValue(blockId, it.role, next)
                        : __blocks_setBlockParamValue(blockId, it.key, next);
                    if (!res || res.ok !== true) {
                        const desc = isApertureItem ? `${blockId}.aperture.${String(it.role ?? '')}` : `${blockId}.${it.key}`;
                        alert(`Failed to update ${desc}: ${res?.reason || 'unknown error'}`);
                        return false;
                    }
                    try { refreshBlockInspector(); } catch (_) {}
                    return true;
                };

                let valueEl;
                if (isObjectModeItem) {
                    const sel = document.createElement('select');
                    sel.style.flex = '0 0 180px';
                    sel.style.fontSize = '12px';
                    sel.style.padding = '2px 6px';
                    sel.style.border = '1px solid #ddd';
                    sel.style.borderRadius = '4px';
                    sel.addEventListener('click', (e) => e.stopPropagation());
                    sel.innerHTML = [
                        '<option value="Finite">Finite</option>',
                        '<option value="INF">INF</option>'
                    ].join('');
                    const cur = String(currentValue ?? '').trim().replace(/\s+/g, '').toUpperCase();
                    sel.value = (cur === 'INF' || cur === 'INFINITY') ? 'INF' : 'Finite';
                    sel.addEventListener('change', (e) => {
                        e.stopPropagation();
                        const ok = commitValue(String(sel.value ?? 'Finite'));
                        if (!ok) sel.value = (cur === 'INF' || cur === 'INFINITY') ? 'INF' : 'Finite';
                    });
                    valueEl = sel;
                } else if (isSurfTypeItem) {
                    const sel = document.createElement('select');
                    sel.style.flex = '0 0 180px';
                    sel.style.fontSize = '12px';
                    sel.style.padding = '2px 6px';
                    sel.style.border = '1px solid #ddd';
                    sel.style.borderRadius = '4px';
                    sel.addEventListener('click', (e) => e.stopPropagation());

                    sel.innerHTML = [
                        '<option value="">(default: Spherical)</option>',
                        '<option value="Spherical">Spherical</option>',
                        '<option value="Aspheric even">Aspheric even</option>',
                        '<option value="Aspheric odd">Aspheric odd</option>'
                    ].join('');

                    // Normalize current value into one of the options
                    const cur = String(currentValue ?? '').trim();
                    const key = cur.replace(/\s+/g, '').replace(/[_-]+/g, '').toLowerCase();
                    let normalized = '';
                    if (cur === '') normalized = '';
                    else if (key === 'spherical' || key === 'sph' || key === 'std' || key === 'standard') normalized = 'Spherical';
                    else if (key === 'asphericeven' || key === 'asphericaleven' || key === 'evenaspheric' || key === 'evenasphere') normalized = 'Aspheric even';
                    else if (key === 'asphericodd' || key === 'asphericalodd' || key === 'oddaspheric' || key === 'oddasphere') normalized = 'Aspheric odd';
                    else normalized = cur;

                    sel.value = ['','Spherical','Aspheric even','Aspheric odd'].includes(normalized) ? normalized : '';
                    sel.addEventListener('change', (e) => {
                        e.stopPropagation();
                        const ok = commitValue(String(sel.value ?? ''));
                        if (!ok) {
                            // restore
                            sel.value = ['','Spherical','Aspheric even','Aspheric odd'].includes(normalized) ? normalized : '';
                        }
                    });
                    valueEl = sel;
                } else {
                    const valueInput = document.createElement('input');
                    valueInput.type = 'text';
                    valueInput.value = currentValue;
                    valueInput.placeholder = '';
                    valueInput.style.flex = '0 0 180px';
                    valueInput.style.fontSize = '12px';
                    valueInput.style.padding = '2px 6px';
                    valueInput.style.border = '1px solid #ddd';
                    valueInput.style.borderRadius = '4px';
                    valueInput.addEventListener('click', (e) => e.stopPropagation());

                    if (isObjectDistanceItem) {
                        try {
                            const mRaw = getDisplayValue('objectDistanceMode');
                            const m = String(mRaw ?? '').trim().replace(/\s+/g, '').toUpperCase();
                            const isInf = m === 'INF' || m === 'INFINITY';
                            valueInput.disabled = isInf;
                            if (isInf) valueInput.placeholder = '(ignored)';
                        } catch (_) {}
                    }

                    const commit = () => {
                        const ok = commitValue(String(valueInput.value ?? ''));
                        if (!ok) valueInput.value = currentValue;
                    };
                    valueInput.addEventListener('blur', () => { commit(); });
                    valueInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            commit();
                        }
                        e.stopPropagation();
                    });
                    valueEl = valueInput;
                }

                // Material helper UI (inline): keep material + ref index + abbe on the SAME LINE.
                // Suggest behavior (triggered by Enter in ref index / abbe inputs):
                // - If nd/vd inputs are provided: use them.
                // - Else if material is a known glass: use its nd/vd.
                // - Else if material is unknown: show name-based suggestions.
                let materialListEl = null;
                if (isMaterialItem) {
                    const materialKey = String(it?.key ?? '').trim();
                    const mat = String(currentValue ?? '').trim();
                    let curNd = '';
                    let curVd = '';
                    let matIsKnownGlass = false;
                    let matIsNumeric = false;
                    let matNumericNd = NaN;
                    try {
                        if (mat !== '' && mat.toUpperCase() !== 'AIR') {
                            const gd = getGlassDataWithSellmeier(mat);
                            if (gd && Number.isFinite(gd.nd)) {
                                curNd = String(gd.nd);
                                matNumericNd = gd.nd;
                            }
                            if (gd && Number.isFinite(gd.vd)) curVd = String(gd.vd);
                            // Numeric material returns vd=undefined; known glass returns finite vd.
                            matIsKnownGlass = !!(gd && Number.isFinite(gd.nd) && Number.isFinite(gd.vd));
                            matIsNumeric = !!(gd && Number.isFinite(gd.nd) && !Number.isFinite(gd.vd));
                        }
                    } catch (_) {}

                    const ndInput = document.createElement('input');
                    ndInput.type = 'text';
                    ndInput.dataset.glassHelper = 'nd';
                    ndInput.dataset.blockId = String(blockId ?? '');
                    ndInput.dataset.materialKey = materialKey;
                    ndInput.placeholder = curNd !== '' ? curNd : 'ref index';
                    ndInput.value = '';
                    ndInput.style.flex = '0 0 86px';
                    ndInput.style.fontSize = '12px';
                    ndInput.style.padding = '2px 6px';
                    ndInput.style.border = '1px solid #ddd';
                    ndInput.style.borderRadius = '4px';
                    ndInput.title = 'ref index (nd)';
                    ndInput.addEventListener('click', (e) => e.stopPropagation());

                    const vdInput = document.createElement('input');
                    vdInput.type = 'text';
                    vdInput.dataset.glassHelper = 'vd';
                    vdInput.dataset.blockId = String(blockId ?? '');
                    vdInput.dataset.materialKey = materialKey;
                    vdInput.placeholder = curVd !== '' ? curVd : 'abbe';
                    vdInput.value = '';
                    vdInput.style.flex = '0 0 86px';
                    vdInput.style.fontSize = '12px';
                    vdInput.style.padding = '2px 6px';
                    vdInput.style.border = '1px solid #ddd';
                    vdInput.style.borderRadius = '4px';
                    vdInput.title = 'Abbe number (vd)';
                    vdInput.addEventListener('click', (e) => e.stopPropagation());

                    const markPreferred = () => {
                        try {
                            if (materialKey) __blockInspectorPreferredMaterialKeyByBlockId.set(String(blockId), materialKey);
                        } catch (_) {}
                    };
                    try {
                        // Prefer the currently focused field for toolbar "Find Glass".
                        ndInput.addEventListener('focus', markPreferred);
                        vdInput.addEventListener('focus', markPreferred);
                        if (valueEl && typeof valueEl === 'object' && 'addEventListener' in valueEl) {
                            valueEl.addEventListener('focus', markPreferred);
                        }
                    } catch (_) {}

                    const listEl = document.createElement('div');
                    listEl.style.display = 'none';
                    listEl.style.margin = '2px 0 0 0';
                    listEl.style.padding = '6px';
                    listEl.style.border = '1px solid #eee';
                    listEl.style.borderRadius = '6px';
                    listEl.style.background = '#fafafa';
                    listEl.style.fontSize = '12px';
                    listEl.addEventListener('click', (e) => e.stopPropagation());

                    const renderNdVdCandidates = (targetNd, targetVd) => {
                        const candidates = findSimilarGlassesByNdVd(targetNd, targetVd, 12);
                        if (!Array.isArray(candidates) || candidates.length === 0) {
                            listEl.style.display = '';
                            listEl.textContent = 'No candidates.';
                            return;
                        }
                        listEl.style.display = '';
                        listEl.innerHTML = '';

                        const head = document.createElement('div');
                        head.style.marginBottom = '4px';
                        head.style.color = '#666';
                        head.textContent = `Closest glasses to nd=${targetNd} vd=${targetVd}`;
                        listEl.appendChild(head);

                        for (let i = 0; i < Math.min(10, candidates.length); i++) {
                            const g = candidates[i];
                            const rowEl = document.createElement('div');
                            rowEl.style.display = 'flex';
                            rowEl.style.alignItems = 'center';
                            rowEl.style.justifyContent = 'space-between';
                            rowEl.style.padding = '2px 4px';
                            rowEl.style.borderRadius = '4px';
                            rowEl.style.cursor = 'pointer';
                            rowEl.addEventListener('mouseenter', () => { rowEl.style.background = '#f2f2f2'; });
                            rowEl.addEventListener('mouseleave', () => { rowEl.style.background = ''; });
                            rowEl.addEventListener('click', (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const name = String(g?.name ?? '').trim();
                                if (!name) return;
                                const ok = commitValue(name);
                                if (ok) {
                                    listEl.style.display = 'none';
                                    listEl.innerHTML = '';
                                }
                            });

                            const left = document.createElement('div');
                            left.textContent = `${i + 1}. ${String(g.name)}`;
                            const right = document.createElement('div');
                            right.style.color = '#777';
                            right.style.fontSize = '11px';
                            right.textContent = `${Number(g.nd).toFixed(6)} / ${Number(g.vd).toFixed(2)}  (Δn=${(Number(g.ndDiff) >= 0 ? '+' : '') + Number(g.ndDiff).toFixed(6)}, Δv=${(Number(g.vdDiff) >= 0 ? '+' : '') + Number(g.vdDiff).toFixed(2)})`;
                            rowEl.appendChild(left);
                            rowEl.appendChild(right);
                            listEl.appendChild(rowEl);
                        }
                    };

                    const renderNameCandidates = (query) => {
                        const candidates = findSimilarGlassNames(String(query ?? ''), 12);
                        if (!Array.isArray(candidates) || candidates.length === 0) {
                            listEl.style.display = '';
                            listEl.textContent = 'No name matches.';
                            return;
                        }
                        listEl.style.display = '';
                        listEl.innerHTML = '';

                        const head = document.createElement('div');
                        head.style.marginBottom = '4px';
                        head.style.color = '#666';
                        head.textContent = `Unknown glass. Name suggestions for "${String(query)}"`;
                        listEl.appendChild(head);

                        for (let i = 0; i < Math.min(10, candidates.length); i++) {
                            const g = candidates[i];
                            const rowEl = document.createElement('div');
                            rowEl.style.display = 'flex';
                            rowEl.style.alignItems = 'center';
                            rowEl.style.justifyContent = 'space-between';
                            rowEl.style.padding = '2px 4px';
                            rowEl.style.borderRadius = '4px';
                            rowEl.style.cursor = 'pointer';
                            rowEl.addEventListener('mouseenter', () => { rowEl.style.background = '#f2f2f2'; });
                            rowEl.addEventListener('mouseleave', () => { rowEl.style.background = ''; });
                            rowEl.addEventListener('click', (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const name = String(g?.name ?? '').trim();
                                if (!name) return;
                                const ok = commitValue(name);
                                if (ok) {
                                    listEl.style.display = 'none';
                                    listEl.innerHTML = '';
                                }
                            });

                            const left = document.createElement('div');
                            left.textContent = `${i + 1}. ${String(g.name)}`;
                            const right = document.createElement('div');
                            right.style.color = '#777';
                            right.style.fontSize = '11px';
                            right.textContent = `score=${Number(g.score).toFixed(0)}`;
                            rowEl.appendChild(left);
                            rowEl.appendChild(right);
                            listEl.appendChild(rowEl);
                        }
                    };

                    const pickTargetNdVd = () => {
                        const nRaw = Number.parseFloat(String(ndInput.value ?? '').trim());
                        const vRaw = Number.parseFloat(String(vdInput.value ?? '').trim());
                        if (Number.isFinite(nRaw) && Number.isFinite(vRaw)) return { nd: nRaw, vd: vRaw };

                        // If material is a known glass, Suggest should work without manual nd/vd.
                        if (matIsKnownGlass) {
                            const nd = Number.parseFloat(curNd);
                            const vd = Number.parseFloat(curVd);
                            if (Number.isFinite(nd) && Number.isFinite(vd)) return { nd, vd };
                        }

                        // Numeric material: allow using vd input if provided.
                        if (matIsNumeric) {
                            const vd = Number.parseFloat(String(vdInput.value ?? '').trim());
                            if (Number.isFinite(matNumericNd) && Number.isFinite(vd)) return { nd: matNumericNd, vd };
                        }
                        return null;
                    };

                    const suggest = () => {
                        const t = pickTargetNdVd();
                        if (t) {
                            renderNdVdCandidates(t.nd, t.vd);
                            return;
                        }
                        // Fall back to name-based suggestions for unknown glass names.
                        const q = String(mat ?? '').trim();
                        if (q === '') {
                            alert('Enter a material name or nd/vd first.');
                            return;
                        }
                        renderNameCandidates(q);
                    };

                    const suggestOnEnter = (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            suggest();
                        }
                    };
                    ndInput.addEventListener('keydown', suggestOnEnter);
                    vdInput.addEventListener('keydown', suggestOnEnter);

                    materialListEl = listEl;

                    // Defer inserting ref index/abbe until after the material input is added,
                    // so the final order is: Optimize, Per-config, material, ref index, abbe.
                    materialListEl.__inlineControls = { ndInput, vdInput };
                }

                if (allowOptimize) {
                    const label = document.createElement('label');
                    label.style.display = 'flex';
                    label.style.alignItems = 'center';
                    label.style.gap = '6px';
                    label.style.flex = '0 0 auto';
                    label.addEventListener('click', (e) => e.stopPropagation());
                    {
                        const txt = document.createElement('span');
                        txt.textContent = 'Optimize';
                        label.appendChild(cb);
                        label.appendChild(txt);
                    }
                    line.appendChild(label);
                    line.appendChild(scopeSel);
                } else {
                    const spacer = document.createElement('div');
                    spacer.style.flex = '0 0 176px';
                    line.appendChild(spacer);
                }
                line.appendChild(name);
                line.appendChild(valueEl);

                // For material rows: add ref index + abbe after the material input.
                try {
                    const ctrls = materialListEl && materialListEl.__inlineControls ? materialListEl.__inlineControls : null;
                    if (ctrls && ctrls.ndInput && ctrls.vdInput) {
                        line.appendChild(ctrls.ndInput);
                        line.appendChild(ctrls.vdInput);
                    }
                } catch (_) {}
                panel.appendChild(line);

                if (materialListEl) {
                    panel.appendChild(materialListEl);
                }
            }

            container.appendChild(panel);
        }
    }
}

function refreshBlockInspector() {
    const banner = document.getElementById('import-analyze-mode-banner');
    const setBannerVisible = (isVisible) => {
        if (!banner) return;
        banner.style.display = isVisible ? '' : 'none';
    };

    try {
        // IMPORTANT: use the same configuration source as Load/Save (localStorage systemConfigurations).
        // A missing active config here makes the UI falsely fall back into Import/Analyze mode.
        const activeCfg = (typeof getActiveConfiguration === 'function') ? getActiveConfiguration() : null;
        const blocks = activeCfg && Array.isArray(activeCfg.blocks) ? activeCfg.blocks : null;

        try {
            // Show Import/Analyze banner only when blocks are actually unavailable.
            // (Some legacy imports may carry metadata.importAnalyzeMode=true; ignore it when blocks exist.)
            const isImportAnalyze = !blocks || blocks.length === 0;
            setBannerVisible(!!isImportAnalyze);
        } catch (_) {}

        if (blocks && blocks.length > 0) {
            // Blocks-only mode: hide Expanded Optical System surface editor.
            __blocks_setExpandedOpticalSystemUIVisible(false);

            // In Blocks-only mode we intentionally do NOT maintain OpticalSystemTableData,
            // so dumpOpticalSystemProvenance() would return empty. Instead, derive counts
            // from the deterministic Blocks->Rows expansion.
            const countById = new Map();
            try {
                if (typeof expandBlocksToOpticalSystemRows === 'function') {
                    const exp = expandBlocksToOpticalSystemRows(blocks);
                    const rows = exp && Array.isArray(exp.rows) ? exp.rows : [];
                    for (const r of rows) {
                        const bid = r?._blockId;
                        if (bid === null || bid === undefined) continue;
                        const id = String(bid).trim();
                        if (!id || id === '(none)') continue;
                        countById.set(id, (countById.get(id) || 0) + 1);
                    }
                }
            } catch (_) {}

            const merged = blocks.map(b => {
                const id = String(b?.blockId ?? '(none)');
                return {
                    blockId: id,
                    blockType: String(b?.blockType ?? '(none)'),
                    surfaceCount: countById.has(id) ? countById.get(id) : 0,
                    preview: formatBlockPreview(b)
                };
            });

            const blockById = new Map();
            for (const b of blocks) {
                const id = String(b?.blockId ?? '').trim();
                if (!id) continue;
                blockById.set(id, b);
            }
            renderBlockInspector(merged, {}, blockById, blocks);
        } else {
            __blocks_setExpandedOpticalSystemUIVisible(true);
            if (typeof window.dumpOpticalSystemProvenance !== 'function') return;
            const result = window.dumpOpticalSystemProvenance({ quiet: true });
            renderBlockInspector(result?.summary || [], result?.groups || {}, null, null);
        }
    } catch (e) {
        console.warn('⚠️ [Blocks] Failed to refresh block inspector:', e);
    }
}

function __blocks_mapSurfaceEditToBlockChange(edit) {
    const row = edit?.row;
    const field = __blocks_normalizeEditedFieldKey(edit?.field);
    const oldValue = edit?.oldValue;
    const newValue = edit?.newValue;

    if (!row || typeof row !== 'object') return null;
    const blockId = row._blockId;
    const blockType = __blocks_normalizeProvenanceBlockType(row._blockType);
    const role = __blocks_normalizeRole(row._surfaceRole);
    if (!blockId || blockId === '(none)') return null;
    if (!blockType) return null;
    if (oldValue === newValue) return null;
    const isOptimizeFlagField = field === 'optimizeT' || field === 'optimizeR' || field === 'optimizeMaterial' || field === 'optimizeSemiDia';
    if (!isOptimizeFlagField) {
        // Allow INF for radius (common for plane surfaces). Still reject AUTO/blank.
        if (__blocks_isAutoOrBlankValue(newValue)) return null;
        if (__blocks_isInfValue(newValue) && field !== 'radius') return null;
    }

    const normalizeSurfType = (v) => {
        const s = String(v ?? '').trim();
        if (s === '') return null;
        const key = s.replace(/\s+/g, '').replace(/[_-]+/g, '').toLowerCase();
        if (key === 'spherical') return 'Spherical';
        if (key === 'asphericeven' || key === 'asphericaleven') return 'Aspheric even';
        if (key === 'asphericodd' || key === 'asphericalodd') return 'Aspheric odd';
        return null;
    };

    // When applying coef/conic edits, also infer the surface type from the *current* expanded row.
    // This prevents coef=0 from being "normalized away" during Blocks->Surfaces re-expansion
    // when the canonical block surfType field is blank.
    const inferRowSurfType = () => {
        try {
            const stRaw = row?.surfType ?? row?.['surf type'] ?? row?.surfTypeName ?? row?.type;
            return normalizeSurfType(stRaw);
        } catch (_) {
            return null;
        }
    };

    const maybeSurfTypeChange = (variableKey) => {
        // If the user is editing conic/coef fields, we must ensure the canonical SurfType
        // is non-spherical. Otherwise, Blocks->Surfaces expansion will choose 'Spherical'
        // when all terms are zero and will clear coef/conic fields, making "apply 0"
        // appear as a no-op.
        const st = inferRowSurfType();
        const normalized = (st === 'Aspheric even' || st === 'Aspheric odd') ? st : null;
        return {
            blockId: String(blockId),
            blockType: String(blockType),
            variable: String(variableKey),
            oldValue: null,
            newValue: normalized || 'Aspheric even'
        };
    };

    if (blockType === 'Lens') {
        if (field === 'semidia') {
            if (role !== 'front' && role !== 'back') return null;
            return { blockId: String(blockId), blockType: 'Lens', kind: 'apertureSemidia', role, oldValue, newValue };
        }
        if (field === 'optimizeT') {
            const mode = String(newValue ?? '').trim().toUpperCase() === 'V' ? 'V' : 'F';
            if (role === 'front') return { blockId: String(blockId), blockType: 'Lens', kind: 'optimizeMode', variable: 'centerThickness', oldValue, newValue: mode };
            if (role === 'back') {
                const airGapId = __blocks_findFollowingAirGapBlockId(blockId);
                if (!airGapId) {
                    console.warn(`⚠️ Lens back optimizeT edit: no following AirGap found for blockId=${blockId}.`);
                    return null;
                }
                return { blockId: String(airGapId), blockType: 'AirGap', kind: 'optimizeMode', variable: 'thickness', oldValue, newValue: mode };
            }
            return null;
        }
        if (field === 'surftype') {
            if (role !== 'front' && role !== 'back') return null;
            const normalized = normalizeSurfType(newValue);
            if (!normalized) return null;
            return { blockId: String(blockId), blockType: 'Lens', variable: role === 'front' ? 'frontSurfType' : 'backSurfType', oldValue, newValue: normalized };
        }
        if (field === 'conic') {
            if (role !== 'front' && role !== 'back') return null;
            const conicVar = role === 'front' ? 'frontConic' : 'backConic';
            const stVar = role === 'front' ? 'frontSurfType' : 'backSurfType';
            const stCh = maybeSurfTypeChange(stVar);
            return stCh ? [stCh, { blockId: String(blockId), blockType: 'Lens', variable: conicVar, oldValue, newValue }] : { blockId: String(blockId), blockType: 'Lens', variable: conicVar, oldValue, newValue };
        }
        const m = /^coef(\d+)$/.exec(field);
        if (m) {
            const idx = Number(m[1]);
            if (!Number.isFinite(idx) || idx < 1 || idx > 10) return null;
            if (role !== 'front' && role !== 'back') return null;
            const coefVar = `${role === 'front' ? 'front' : 'back'}Coef${idx}`;
            const stVar = role === 'front' ? 'frontSurfType' : 'backSurfType';
            const stCh = maybeSurfTypeChange(stVar);
            return stCh ? [stCh, { blockId: String(blockId), blockType: 'Lens', variable: coefVar, oldValue, newValue }] : { blockId: String(blockId), blockType: 'Lens', variable: coefVar, oldValue, newValue };
        }
        if (field === 'radius') {
            if (role === 'front') return { blockId: String(blockId), blockType: 'Lens', variable: 'frontRadius', oldValue, newValue };
            if (role === 'back') return { blockId: String(blockId), blockType: 'Lens', variable: 'backRadius', oldValue, newValue };
            return null;
        }
        if (field === 'material') {
            if (role !== 'front' && role !== 'back') return null;
            const mat = String(newValue ?? '').trim();
            if (!mat || mat.toUpperCase() === 'AIR') return null;
            return { blockId: String(blockId), blockType: 'Lens', variable: 'material', oldValue, newValue: mat };
        }
        if (field === 'thickness') {
            if (role === 'front') return { blockId: String(blockId), blockType: 'Lens', variable: 'centerThickness', oldValue, newValue };
            if (role === 'back') {
                let airGapId = __blocks_findFollowingAirGapBlockId(blockId);
                if (!airGapId) {
                    console.warn(`⚠️ Lens back thickness edit: no following AirGap found for blockId=${blockId}.`);
                    console.log(`✨ Auto-creating AirGap block after ${blockId}...`);
                    airGapId = __blocks_autoCreateFollowingAirGap(blockId, newValue);
                    if (!airGapId) {
                        console.warn(`   Failed to auto-create AirGap. Using fallback: backAirThickness on Lens itself.`);
                        return { blockId: String(blockId), blockType: 'Lens', variable: 'backAirThickness', oldValue, newValue };
                    }
                }
                return { blockId: String(airGapId), blockType: 'AirGap', variable: 'thickness', oldValue, newValue };
            }
            // Fallback: if role is missing or unknown, try to infer or default to centerThickness
            // This handles cases where provenance is incomplete
            console.warn(`⚠️ Lens thickness edit with unknown role: ${role}. Defaulting to centerThickness.`);
            return { blockId: String(blockId), blockType: 'Lens', variable: 'centerThickness', oldValue, newValue };
        }
        return null;
    }

    if (blockType === 'Doublet' || blockType === 'Triplet') {
        if (field === 'semidia') {
            if (!role) return null;
            return { blockId: String(blockId), blockType, kind: 'apertureSemidia', role, oldValue, newValue };
        }
        const surfIdx = __blocks_parseSurfaceIndexFromRole(role);
        if (!surfIdx) {
            // Role is missing or unparseable - try to handle thickness as a fallback
            if (field === 'thickness') {
                console.warn(`⚠️ ${blockType} thickness edit with unparseable role: ${role}. Attempting to apply to following AirGap.`);
                const airGapId = __blocks_findFollowingAirGapBlockId(blockId);
                if (airGapId) {
                    return { blockId: String(airGapId), blockType: 'AirGap', variable: 'thickness', oldValue, newValue };
                }
            }
            return null;
        }
        const elemCount = (blockType === 'Doublet') ? 2 : 3;
        const lastSurfIdx = elemCount + 1;

        if (field === 'optimizeT') {
            const mode = String(newValue ?? '').trim().toUpperCase() === 'V' ? 'V' : 'F';
            if (surfIdx >= 1 && surfIdx <= elemCount) {
                return { blockId: String(blockId), blockType, kind: 'optimizeMode', variable: `thickness${surfIdx}`, oldValue, newValue: mode };
            }
            if (surfIdx === lastSurfIdx) {
                const airGapId = __blocks_findFollowingAirGapBlockId(blockId);
                if (!airGapId) {
                    console.warn(`⚠️ ${blockType} last surface optimizeT edit: no following AirGap found for blockId=${blockId}.`);
                    return null;
                }
                return { blockId: String(airGapId), blockType: 'AirGap', kind: 'optimizeMode', variable: 'thickness', oldValue, newValue: mode };
            }
            return null;
        }

        if (field === 'surftype') {
            const normalized = normalizeSurfType(newValue);
            if (!normalized) return null;
            return { blockId: String(blockId), blockType, variable: `surf${surfIdx}SurfType`, oldValue, newValue: normalized };
        }
        if (field === 'conic') {
            const conicVar = `surf${surfIdx}Conic`;
            const stVar = `surf${surfIdx}SurfType`;
            const stCh = maybeSurfTypeChange(stVar);
            return stCh ? [stCh, { blockId: String(blockId), blockType, variable: conicVar, oldValue, newValue }] : { blockId: String(blockId), blockType, variable: conicVar, oldValue, newValue };
        }
        const m = /^coef(\d+)$/.exec(field);
        if (m) {
            const idx = Number(m[1]);
            if (!Number.isFinite(idx) || idx < 1 || idx > 10) return null;
            const coefVar = `surf${surfIdx}Coef${idx}`;
            const stVar = `surf${surfIdx}SurfType`;
            const stCh = maybeSurfTypeChange(stVar);
            return stCh ? [stCh, { blockId: String(blockId), blockType, variable: coefVar, oldValue, newValue }] : { blockId: String(blockId), blockType, variable: coefVar, oldValue, newValue };
        }
        if (field === 'radius') return { blockId: String(blockId), blockType, variable: `radius${surfIdx}`, oldValue, newValue };
        if (field === 'material') {
            if (surfIdx > elemCount) return null;
            const mat = String(newValue ?? '').trim();
            if (!mat || mat.toUpperCase() === 'AIR') return null;
            return { blockId: String(blockId), blockType, variable: `material${surfIdx}`, oldValue, newValue: mat };
        }
        if (field === 'thickness') {
            if (surfIdx >= 1 && surfIdx <= elemCount) return { blockId: String(blockId), blockType, variable: `thickness${surfIdx}`, oldValue, newValue };
            if (surfIdx === lastSurfIdx) {
                let airGapId = __blocks_findFollowingAirGapBlockId(blockId);
                if (!airGapId) {
                    console.warn(`⚠️ ${blockType} last surface thickness edit: no following AirGap found for blockId=${blockId}.`);
                    console.log(`✨ Auto-creating AirGap block after ${blockId}...`);
                    airGapId = __blocks_autoCreateFollowingAirGap(blockId, newValue);
                    if (!airGapId) {
                        console.warn(`   Failed to auto-create AirGap. Using fallback.`);
                        return { blockId: String(blockId), blockType, variable: `backAirThickness`, oldValue, newValue };
                    }
                }
                return { blockId: String(airGapId), blockType: 'AirGap', variable: 'thickness', oldValue, newValue };
            }
            return null;
        }
        return null;
    }

    if (blockType === 'Stop') {
        if (field === 'optimizeT') {
            const mode = String(newValue ?? '').trim().toUpperCase() === 'V' ? 'V' : 'F';
            const airGapId = __blocks_findFollowingAirGapBlockId(blockId);
            if (!airGapId) {
                console.warn(`⚠️ Stop optimizeT edit: no following AirGap found for blockId=${blockId}.`);
                return null;
            }
            return { blockId: String(airGapId), blockType: 'AirGap', kind: 'optimizeMode', variable: 'thickness', oldValue, newValue: mode };
        }
        if (field === 'semidia') return { blockId: String(blockId), blockType: 'Stop', variable: 'semiDiameter', oldValue, newValue };
        if (field === 'thickness') {
            let airGapId = __blocks_findFollowingAirGapBlockId(blockId);
            if (!airGapId) {
                console.warn(`⚠️ Stop thickness edit: no following AirGap found for blockId=${blockId}.`);
                console.log(`✨ Auto-creating AirGap block after ${blockId}...`);
                airGapId = __blocks_autoCreateFollowingAirGap(blockId, newValue);
                if (!airGapId) {
                    console.warn(`   Failed to auto-create AirGap. Using fallback.`);
                    return { blockId: String(blockId), blockType: 'Stop', variable: 'thickness', oldValue, newValue };
                }
            }
            return { blockId: String(airGapId), blockType: 'AirGap', variable: 'thickness', oldValue, newValue };
        }
        return null;
    }

    if (blockType === 'AirGap') {
        if (field === 'optimizeT') {
            const mode = String(newValue ?? '').trim().toUpperCase() === 'V' ? 'V' : 'F';
            return { blockId: String(blockId), blockType: 'AirGap', kind: 'optimizeMode', variable: 'thickness', oldValue, newValue: mode };
        }
        if (field === 'thickness') return { blockId: String(blockId), blockType: 'AirGap', variable: 'thickness', oldValue, newValue };
        return null;
    }

    if (blockType === 'ImagePlane') {
        // ImagePlane itself typically doesn't have thickness, but the air space before it does
        if (field === 'optimizeT') {
            const mode = String(newValue ?? '').trim().toUpperCase() === 'V' ? 'V' : 'F';
            const airGapId = __blocks_findFollowingAirGapBlockId(blockId);
            if (airGapId) {
                return { blockId: String(airGapId), blockType: 'AirGap', kind: 'optimizeMode', variable: 'thickness', oldValue, newValue: mode };
            }
            return null;
        }
        if (field === 'thickness') {
            const airGapId = __blocks_findFollowingAirGapBlockId(blockId);
            if (airGapId) {
                return { blockId: String(airGapId), blockType: 'AirGap', variable: 'thickness', oldValue, newValue };
            }
            // ImagePlane is usually the last block, so no following AirGap is expected
            // Try to apply to the block itself in case it has a thickness parameter
            console.warn('⚠️ ImagePlane thickness edit: no following AirGap found, attempting to apply to ImagePlane itself');
            return { blockId: String(blockId), blockType: 'ImagePlane', variable: 'thickness', oldValue, newValue };
        }
        return null;
    }

    // Generic fallback for other block types (e.g., Window, Mirror, etc.)
    // If thickness field is edited, try to apply it to the following AirGap
    if (field === 'thickness') {
        const airGapId = __blocks_findFollowingAirGapBlockId(blockId);
        if (airGapId) {
            console.log(`✅ Mapping thickness for blockType=${blockType} to following AirGap ${airGapId}`);
            return { blockId: String(airGapId), blockType: 'AirGap', variable: 'thickness', oldValue, newValue };
        }
        // If no following AirGap, check if this block itself has a thickness parameter/variable
        // (Some blocks like Window or custom types might have their own thickness)
        console.log(`✅ Mapping thickness for blockType=${blockType} to block itself (no following AirGap)`);
        return { blockId: String(blockId), blockType, variable: 'thickness', oldValue, newValue };
    }

    return null;
}

function __blocks_applyChangeToActiveConfig(change) {
    const activeCfg = getActiveConfiguration();
    if (!activeCfg || !Array.isArray(activeCfg.blocks)) return false;
    const target = activeCfg.blocks.find(b => b && String(b.blockId ?? '') === String(change.blockId));
    if (!target) {
        console.warn(`⚠️ Target block not found: ${change.blockId}`);
        return false;
    }

    // Optimization-flag change: update variables[*].optimize.mode.
    if (change && change.kind === 'optimizeMode') {
        const key = String(change.variable ?? '').trim();
        if (!key) return false;
        const enabled = String(change.newValue ?? '').trim().toUpperCase() === 'V';

        if (!target.variables || typeof target.variables !== 'object') target.variables = {};
        if (!target.variables[key] || typeof target.variables[key] !== 'object') {
            target.variables[key] = { value: target.parameters?.[key] ?? '' };
        }
        if (!target.variables[key].optimize || typeof target.variables[key].optimize !== 'object') {
            target.variables[key].optimize = {};
        }

        target.variables[key].optimize.mode = enabled ? 'V' : 'F';
        console.log(`📝 Applying optimize flag to ${change.blockId}.${key}: ${enabled ? 'V' : 'F'}`);

        try {
            const systemConfig = loadSystemConfigurations();
            if (systemConfig && Array.isArray(systemConfig.configurations)) {
                const activeId = systemConfig.activeConfigId;
                const idx = systemConfig.configurations.findIndex(c => c && String(c.id) === String(activeId));
                if (idx >= 0) {
                    systemConfig.configurations[idx] = activeCfg;
                    saveSystemConfigurations(systemConfig);
                    console.log(`💾 Saved optimize flag to localStorage: ${change.blockId}.${key} = ${enabled ? 'V' : 'F'}`);
                }
            }
        } catch (err) {
            console.error('Failed to save optimize flag to localStorage:', err);
        }

        return true;
    }

    // Semidia (aperture) change: persist into Design Intent (blocks) as block.aperture[role].
    if (change && change.kind === 'apertureSemidia') {
        const role = String(change.role ?? '').trim();
        if (!role) return false;
        if (!target.aperture || typeof target.aperture !== 'object') target.aperture = {};
        target.aperture[role] = change.newValue;

        try {
            const systemConfig = loadSystemConfigurations();
            if (systemConfig && Array.isArray(systemConfig.configurations)) {
                const activeId = systemConfig.activeConfigId;
                const idx = systemConfig.configurations.findIndex(c => c && String(c.id) === String(activeId));
                if (idx >= 0) {
                    systemConfig.configurations[idx] = activeCfg;
                    saveSystemConfigurations(systemConfig);
                    console.log(`💾 Saved aperture semidia to localStorage: ${change.blockId} [${role}] = ${change.newValue}`);
                }
            }
        } catch (err) {
            console.error('Failed to save aperture semidia to localStorage:', err);
        }
        return true;
    }

    if (!target.parameters || typeof target.parameters !== 'object') target.parameters = {};
    
    console.log(`📝 Applying change to ${change.blockId}.${change.variable}: ${change.oldValue} → ${change.newValue}`);
    
    // Canonical value lives in parameters (used by expandBlocksToOpticalSystemRows via getParamOrVarValue).
    // Also mirror into variables.value when present so inspector/UI stays consistent.
    target.parameters[change.variable] = change.newValue;
    if (target.variables && typeof target.variables === 'object' && target.variables[change.variable] && typeof target.variables[change.variable] === 'object') {
        target.variables[change.variable].value = change.newValue;
    }
    
    // Persist to localStorage
    try {
        const systemConfig = loadSystemConfigurations();
        if (systemConfig && Array.isArray(systemConfig.configurations)) {
            const activeId = systemConfig.activeConfigId;
            const idx = systemConfig.configurations.findIndex(c => c && String(c.id) === String(activeId));
            if (idx >= 0) {
                systemConfig.configurations[idx] = activeCfg;
                saveSystemConfigurations(systemConfig);
                console.log(`💾 Saved change to localStorage: ${change.blockId}.${change.variable} = ${change.newValue}`);
            }
        }
    } catch (err) {
        console.error('Failed to save change to localStorage:', err);
    }
    
    return true;
}

function __blocks_debugVerifyAppliedChanges(activeCfg, changes, expandedRows) {
    try {
        const debugEnabled = !!globalThis.__cooptDebugApplyToDesignIntent;
        if (!debugEnabled) return;
        const cfg = activeCfg && typeof activeCfg === 'object' ? activeCfg : null;
        const blocks = cfg && Array.isArray(cfg.blocks) ? cfg.blocks : [];
        const rows = Array.isArray(expandedRows) ? expandedRows : [];

        const mapChangeToRoleField = (ch) => {
            if (!ch || typeof ch !== 'object') return null;
            if (ch.kind) return null; // optimizeMode / apertureSemidia
            const variable = String(ch.variable ?? '').trim();
            if (!variable) return null;

            let role = null;
            let field = null;

            // Lens
            if (variable.startsWith('front')) role = 'front';
            if (variable.startsWith('back')) role = 'back';

            // Doublet/Triplet surfN
            const mSurf = /^surf(\d+)(SurfType|Conic|Coef\d+)$/.exec(variable);
            if (mSurf) role = `s${mSurf[1]}`;

            if (variable.endsWith('SurfType')) field = 'surfType';
            else if (variable.endsWith('Conic')) field = 'conic';
            else {
                const m = /Coef(\d+)$/.exec(variable);
                if (m) field = `coef${m[1]}`;
            }
            if (!role || !field) return null;
            return { role, field };
        };

        const records = [];
        for (const ch of changes.slice(0, 20)) {
            const blockId = String(ch?.blockId ?? '');
            const blockType = String(ch?.blockType ?? '');
            const variable = String(ch?.variable ?? ch?.kind ?? '');
            const mapping = mapChangeToRoleField(ch);

            const b = blocks.find(x => x && String(x.blockId ?? '') === blockId) || null;
            const stored = b && b.parameters && typeof b.parameters === 'object' ? b.parameters[ch.variable] : undefined;

            let rowValue = undefined;
            if (mapping) {
                const rr = rows.find(r => r && String(r._blockId ?? '') === blockId && String(r._surfaceRole ?? '') === mapping.role) || null;
                rowValue = rr ? rr[mapping.field] : undefined;
            }

            records.push({
                blockId,
                blockType,
                variable,
                oldValue: ch?.oldValue,
                newValue: ch?.newValue,
                role: mapping?.role ?? null,
                surfaceField: mapping?.field ?? null,
                storedInBlock: stored,
                expandedRowValue: rowValue
            });
        }

        console.log('🧪 [ApplyToDesignIntent] Debug verify (enable flag: __cooptDebugApplyToDesignIntent=true):');
        console.table(records);
    } catch (e) {
        console.warn('⚠️ [ApplyToDesignIntent] Debug verify failed:', e);
    }
}

function setupApplyToDesignIntentButton() {
    const btn = document.getElementById('apply-to-design-intent-btn');
    if (!btn) return;

    // Guard: setupDOMEventHandlers can be invoked more than once in some loading flows.
    // Avoid registering duplicate click handlers (would Apply twice).
    if (btn.dataset && btn.dataset.applyToDesignIntentBound === '1') return;
    if (btn.dataset) btn.dataset.applyToDesignIntentBound = '1';

    btn.addEventListener('click', () => {
        try {
            const tbl = window.tableOpticalSystem || globalThis.tableOpticalSystem;
            const rows = (tbl && typeof tbl.getData === 'function') ? tbl.getData() : null;
            if (!Array.isArray(rows) || rows.length === 0) {
                alert('Expanded Optical System が見つかりません。');
                return;
            }

            const ensureBlocksFromCurrentSurfacesIfNeeded = () => {
                const activeCfg = (typeof getActiveConfiguration === 'function') ? getActiveConfiguration() : null;
                if (!activeCfg) return { ok: false, reason: 'active configuration not found.' };

                // If expanded rows carry no provenance, Blocks are effectively unavailable.
                const hasProvenance = rows.some(r => r && typeof r === 'object' && r._blockId && String(r._blockId).trim() !== '');
                const hasBlocks = Array.isArray(activeCfg.blocks) && activeCfg.blocks.length > 0;
                if (hasBlocks && hasProvenance) return { ok: true, changed: false };

                const derived = deriveBlocksFromLegacyOpticalSystemRows(rows);
                const fatals = Array.isArray(derived?.issues) ? derived.issues.filter(i => i && i.severity === 'fatal') : [];
                if (fatals.length > 0) {
                    // Keep surface workflow; report why Blocks could not be derived.
                    try {
                        const warnings = fatals.map(f => ({ ...f, severity: 'warning', message: `Blocks conversion skipped: ${f?.message || String(f)}` }));
                        showLoadErrors(warnings, { filename: '(apply)' });
                    } catch (_) {}
                    return { ok: false, reason: 'Blocks conversion failed.' };
                }

                activeCfg.schemaVersion = activeCfg.schemaVersion || BLOCK_SCHEMA_VERSION;
                activeCfg.blocks = Array.isArray(derived?.blocks) ? derived.blocks : [];
                if (!activeCfg.metadata || typeof activeCfg.metadata !== 'object') activeCfg.metadata = {};
                activeCfg.metadata.importAnalyzeMode = false;

                // Persist mutated active config back into localStorage systemConfigurations.
                try {
                    const systemConfig = (typeof loadSystemConfigurations === 'function') ? loadSystemConfigurations() : null;
                    if (systemConfig && Array.isArray(systemConfig.configurations)) {
                        const activeId = systemConfig.activeConfigId;
                        const idx = systemConfig.configurations.findIndex(c => c && String(c.id) === String(activeId));
                        if (idx >= 0) systemConfig.configurations[idx] = activeCfg;
                        localStorage.setItem('systemConfigurations', JSON.stringify(systemConfig));
                    }
                } catch (_) {}

                // Re-expand now so rows get provenance for subsequent Apply.
                try {
                    const expanded = expandBlocksToOpticalSystemRows(activeCfg.blocks);
                    try { __blocks_mergeLegacyIndexFieldsIntoExpandedRows(rows, expanded.rows); } catch (_) {}
                    localStorage.setItem('OpticalSystemTableData', JSON.stringify(expanded.rows));
                    try { saveLensTableData(expanded.rows); } catch (_) {}
                    try { if (tbl && typeof tbl.setData === 'function') tbl.setData(expanded.rows); } catch (_) {}
                    try { refreshBlockInspector(); } catch (_) {}
                } catch (_) {}

                return { ok: true, changed: true };
            };

            /** @type {Array<{row:any, field:string, oldValue:any, newValue:any}>} */
            const edits = [];
            try {
                const pending = globalThis.__pendingSurfaceEdits;
                if (pending && typeof pending === 'object') {
                    for (const [key, v] of Object.entries(pending)) {
                        const [sidRaw, fieldRaw] = String(key).split(':');
                        const surfaceId = Number(sidRaw);
                        const field = String(fieldRaw ?? '').trim();
                        if (!Number.isFinite(surfaceId) || !field) continue;
                        const row = rows.find(r => r && typeof r.id === 'number' && r.id === surfaceId);
                        if (!row) continue;
                        edits.push({ row, field, oldValue: v?.oldValue, newValue: row[field] });
                    }
                }
            } catch (_) {}
            if (edits.length === 0 && globalThis.__lastSurfaceEdit) edits.push(globalThis.__lastSurfaceEdit);

            // Fallback: Tabulator may not have populated __pendingSurfaceEdits/__lastSurfaceEdit in some setups.
            // Use the currently selected cell as an Apply target.
            if (edits.length === 0) {
                try {
                    const cells = (tbl && typeof tbl.getSelectedCells === 'function') ? tbl.getSelectedCells() : [];
                    const cell = Array.isArray(cells) && cells.length > 0 ? cells[cells.length - 1] : null;
                    if (cell && typeof cell.getField === 'function' && typeof cell.getRow === 'function') {
                        const field = cell.getField();
                        const rowData = cell.getRow()?.getData?.() ?? null;
                        const newValue = (typeof cell.getValue === 'function') ? cell.getValue() : (rowData ? rowData[field] : undefined);
                        let oldValue = undefined;
                        try { oldValue = (typeof cell.getOldValue === 'function') ? cell.getOldValue() : undefined; } catch (_) {}
                        // If we still don't have oldValue, use a neutral value so the mapping path runs.
                        if (oldValue === undefined) oldValue = null;
                        if (rowData) edits.push({ row: rowData, field, oldValue, newValue });
                    }
                } catch (_) {}
            }

            // Fallback 2: if selection is unavailable, use the last active surface cell metadata.
            if (edits.length === 0) {
                try {
                    const last = globalThis.__lastActiveSurfaceCell || globalThis.__lastSelectedSurfaceCell;
                    const surfaceId = Number(last?.surfaceId);
                    const field = String(last?.field ?? '').trim();
                    if (Number.isFinite(surfaceId) && field) {
                        const row = rows.find(r => r && typeof r.id === 'number' && r.id === surfaceId);
                        if (row) edits.push({ row, field, oldValue: null, newValue: row[field] });
                    }
                } catch (_) {}
            }
            if (edits.length === 0) {
                alert('Apply対象の変更が見つかりません。');
                return;
            }

            const changes = edits.flatMap((e) => {
                const mapped = __blocks_mapSurfaceEditToBlockChange(e);
                if (!mapped) return [];
                return Array.isArray(mapped) ? mapped.filter(Boolean) : [mapped];
            });
            if (changes.length === 0) {
                let debugInfo = '';
                try {
                    console.warn('⚠️ [Blocks] No mappable changes from edits. Details:');
                    for (const e of edits) {
                        const reason = __blocks_explainSurfaceEditMappingFailure(e);
                        const normalizedField = __blocks_normalizeEditedFieldKey(e?.field);
                        const normalizedBlockType = __blocks_normalizeProvenanceBlockType(e?.row?._blockType);
                        const normalizedRole = __blocks_normalizeRole(e?.row?._surfaceRole);
                        const info = {
                            field: e?.field,
                            normalizedField,
                            oldValue: e?.oldValue,
                            newValue: e?.newValue,
                            blockId: e?.row?._blockId,
                            blockType: e?.row?._blockType,
                            normalizedBlockType,
                            surfaceRole: e?.row?._surfaceRole,
                            normalizedRole,
                            reason
                        };
                        console.warn('  - edit:', info);
                        debugInfo += `\n• Field: ${normalizedField} (raw: ${e?.field})\n  BlockType: ${normalizedBlockType} (raw: ${info.blockType || '(none)'})\n  Role: ${normalizedRole} (raw: ${info.surfaceRole || '(none)'})\n  Reason: ${reason}`;
                    }
                } catch (_) {}

                // If we can't map edits, Blocks/provenance may be missing. Auto-derive Blocks once.
                const ensured = ensureBlocksFromCurrentSurfacesIfNeeded();
                if (ensured && ensured.ok && ensured.changed) {
                    alert('Design Intent (Blocks) を Surface から自動生成しました。\n\nもう一度 Apply を押してください。');
                    return;
                }

                alert('Apply可能な変更がありません（Blocksへ逆マッピング未対応か、値が不正です）。\n\n詳細はコンソールを確認してください。' + debugInfo);
                return;
            }

            let applied = 0;
            for (const ch of changes) if (__blocks_applyChangeToActiveConfig(ch)) applied++;
            if (applied === 0) {
                // Common failure mode: expanded rows have provenance but the active configuration
                // has no matching blocks (e.g. storage mismatch / legacy import state).
                // Try to derive Blocks once from current surfaces, then ask user to Apply again.
                try {
                    const ensured = ensureBlocksFromCurrentSurfacesIfNeeded();
                    if (ensured && ensured.ok && ensured.changed) {
                        alert('Design Intent (Blocks) を Surface から自動生成しました。\n\nもう一度 Apply を押してください。');
                        return;
                    }
                } catch (_) {}

                try {
                    const activeCfg = (typeof getActiveConfiguration === 'function') ? getActiveConfiguration() : null;
                    const ids = new Set((activeCfg && Array.isArray(activeCfg.blocks)) ? activeCfg.blocks.map(b => String(b?.blockId ?? '')) : []);
                    const missing = changes
                        .map(c => String(c?.blockId ?? ''))
                        .filter(id => id && !ids.has(id));
                    if (missing.length > 0) {
                        console.warn('⚠️ [Blocks] Apply failed: target blocks missing in active config:', missing);
                    }
                } catch (_) {}

                alert('Blocksへの反映に失敗しました。\n\n詳細はコンソールを確認してください。');
                return;
            }

            try {
                const activeCfg = (typeof getActiveConfiguration === 'function') ? getActiveConfiguration() : null;
                if (activeCfg && Array.isArray(activeCfg.blocks)) {
                    const issues = validateBlocksConfiguration(activeCfg);
                    const fatals = issues.filter(i => i && i.severity === 'fatal');
                    if (fatals.length > 0) {
                        try { showLoadErrors(issues, { filename: '(active config)' }); } catch (_) {}
                        return;
                    }
                    const prevRows = (tbl && typeof tbl.getData === 'function') ? tbl.getData() : null;
                    const expanded = expandBlocksToOpticalSystemRows(activeCfg.blocks);
                    try { __blocks_debugVerifyAppliedChanges(activeCfg, changes, expanded.rows); } catch (_) {}
                    try { __blocks_mergeLegacyIndexFieldsIntoExpandedRows(prevRows, expanded.rows); } catch (_) {}
                    try { __blocks_mergeLegacySemidiaIntoExpandedRows(prevRows, expanded.rows); } catch (_) {}
                    localStorage.setItem('OpticalSystemTableData', JSON.stringify(expanded.rows));
                    try { saveLensTableData(expanded.rows); } catch (_) {}
                    try { if (window.tableOpticalSystem && typeof window.tableOpticalSystem.setData === 'function') window.tableOpticalSystem.setData(expanded.rows); } catch (_) {}
                }
            } catch (e) {
                console.warn('⚠️ Failed to validate/expand blocks:', e);
            }

            try { refreshBlockInspector(); } catch (_) {}
            try { globalThis.__pendingSurfaceEdits = {}; } catch (_) {}
            // Auto redraw 3D popup after Apply
            try {
                const popup = window.popup3DWindow;
                if (popup && !popup.closed && typeof popup.postMessage === 'function') {
                    popup.postMessage({ action: 'request-redraw' }, '*');
                }
            } catch (_) {}
            console.log(`✅ Applied ${applied}/${changes.length} changes to Blocks`);
        } catch (e) {
            console.error('❌ Apply to Design Intent failed:', e);
            alert(`Apply failed: ${e?.message || String(e)}`);
        }
    });
}
