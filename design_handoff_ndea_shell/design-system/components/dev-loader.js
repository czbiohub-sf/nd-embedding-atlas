/* Fallback for cards and kits before the compiled bundle exists: loads the component sources and transpiles them in the browser. */
window.ndeaLoad = async function (root) {
  const find = () => { for (const k of Object.keys(window)) { if (!/DesignSystem/i.test(k)) continue; try { const v = window[k]; if (v && v.Tile && v.CommandMenu) return v; } catch (e) {} } return null; };
  if (find()) return find();
  await new Promise((res) => { const s = document.createElement('script'); s.src = root + '_ds_bundle.js'; s.onload = res; s.onerror = res; document.head.appendChild(s); });
  if (find()) return find();
  const files = ['core/Icon', 'core/Button', 'core/IconButton', 'core/OverlayControls', 'forms/Input', 'forms/Select', 'forms/Checkbox', 'forms/RangeSlider', 'data/Kbd', 'data/Badge', 'data/Pill', 'data/Legend', 'data/ScopeIndicator', 'data/DataTable', 'navigation/SegmentedControl', 'navigation/Tabs', 'navigation/SidebarRail', 'layout/Tile', 'overlay/Popover', 'overlay/Menu', 'overlay/Toast', 'overlay/Tooltip', 'command/CommandMenu'];
  const names = [];
  const src = (await Promise.all(files.map((f) => fetch(root + 'components/' + f + '.jsx').then((r) => r.text())))).map((t) => t.replace(/^import .*$/gm, '').replace(/export (function|const) (\w+)/g, (m, k, n) => { names.push(n); return k + ' ' + n; })).join('\n');
  const code = Babel.transform('(function(){' + src + '\nwindow.__ndeaOut = {' + names.join(',') + '};})();', { presets: ['react'] }).code;
  new Function('React', code)(React); window.NdeaDev = window.__ndeaOut;
  return window.NdeaDev;
};
