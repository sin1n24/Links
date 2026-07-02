// Links Web - persistent settings
//
// Replaces Common/config.h (which read/wrote config.ini next to Links.exe:
// screen size, font size/weight, arc-segmentation precision "plspan",
// background brightness, and the last-opened file path). There's no
// filesystem to write next to on the web, so this uses localStorage.
//
// Two settings from config.ini are intentionally dropped rather than
// ported, since they no longer mean anything once implemented on the web:
//   - screen.x/screen.y, fontsize, bold: the page is responsive HTML/CSS
//     now, not a fixed-size DX window.
//   - plspan (arc-segmentation precision on DXF read): dxf_io.js delegates
//     arc sampling to the vendored `dxf` library, which picks its own
//     angular resolution - see dxf_io.js header.
// `BGcolor` (background brightness) IS ported, as a real, user-facing
// setting - the original read it from config.ini but never exposed it
// through any icon/parameter row, so in practice almost nobody could
// change it. Exposing it in the UI is a small, deliberate improvement.

const Config = (() => {
    const SETTINGS_KEY = 'links-web:config';
    const AUTOSAVE_KEY = 'links-web:autosave-scene';

    const defaults = () => ({ bgColor: 0, hasRunBefore: false });

    function load() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            return raw ? Object.assign(defaults(), JSON.parse(raw)) : defaults();
        } catch (e) {
            return defaults();
        }
    }

    function save(partial) {
        try {
            const merged = Object.assign(load(), partial);
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
            return merged;
        } catch (e) {
            return partial;
        }
    }

    function saveAutosave(sceneObj) {
        try {
            localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(sceneObj));
        } catch (e) { /* storage full/unavailable - silently skip autosave */ }
    }

    function loadAutosave() {
        try {
            const raw = localStorage.getItem(AUTOSAVE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function clearAutosave() {
        try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) { /* ignore */ }
    }

    return { load, save, saveAutosave, loadAutosave, clearAutosave };
})();
