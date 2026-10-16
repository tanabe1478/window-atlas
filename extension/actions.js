// Shared by GNOME Shell, the preferences process, and Node tests.
const fraction = (x, y, width, height) => ({x, y, width, height});
const binding = key => `<Super><Control><Alt>${key}`;

export const GROUPS = [
    ['memory', '位置の記憶・復元'],
    ['basic', '基本操作'],
    ['halves', '半分に配置'],
    ['corners', '四隅に配置'],
    ['thirds', '横方向の1/3・2/3'],
    ['vertical-thirds', '縦方向の1/3・2/3'],
    ['third-cycle', '1/3領域を巡回'],
    ['other', 'サイズ・ディスプレイ・履歴'],
];

export const ACTIONS = [
    {id: 'remember-window', title: 'このウィンドウの位置を記憶', group: 'memory', accelerator: binding('s')},
    {id: 'recall-window', title: '記憶した位置に復元', group: 'memory', accelerator: binding('l')},
    {id: 'remember-all', title: '全ウィンドウの配置を記憶', group: 'memory'},
    {id: 'recall-all', title: '開いているウィンドウの配置を復元', group: 'memory'},
    {id: 'maximize', title: '最大化', group: 'basic', accelerator: binding('f')},
    {id: 'center', title: '中央に配置', group: 'basic', accelerator: binding('c')},
    {id: 'restore', title: '最初の位置・サイズに戻す', group: 'basic', accelerator: binding('r')},
    {id: 'left-half', title: '左半分', group: 'halves', accelerator: binding('Left'), layouts: [fraction(0, 0, 1 / 2, 1), fraction(0, 0, 2 / 3, 1), fraction(0, 0, 1 / 3, 1)]},
    {id: 'right-half', title: '右半分', group: 'halves', accelerator: binding('Right'), layouts: [fraction(1 / 2, 0, 1 / 2, 1), fraction(1 / 3, 0, 2 / 3, 1), fraction(2 / 3, 0, 1 / 3, 1)]},
    {id: 'top-half', title: '上半分', group: 'halves', accelerator: binding('Up'), layouts: [fraction(0, 0, 1, 1 / 2), fraction(0, 0, 1, 2 / 3), fraction(0, 0, 1, 1 / 3)]},
    {id: 'bottom-half', title: '下半分', group: 'halves', accelerator: binding('Down'), layouts: [fraction(0, 1 / 2, 1, 1 / 2), fraction(0, 1 / 3, 1, 2 / 3), fraction(0, 2 / 3, 1, 1 / 3)]},
    // Spectacle varies the width of corner layouts; height stays at one half.
    {id: 'top-left', title: '左上', group: 'corners', accelerator: binding('<Shift>Left'), layouts: [fraction(0, 0, 1 / 2, 1 / 2), fraction(0, 0, 2 / 3, 1 / 2), fraction(0, 0, 1 / 3, 1 / 2)]},
    {id: 'top-right', title: '右上', group: 'corners', accelerator: binding('<Shift>Right'), layouts: [fraction(1 / 2, 0, 1 / 2, 1 / 2), fraction(1 / 3, 0, 2 / 3, 1 / 2), fraction(2 / 3, 0, 1 / 3, 1 / 2)]},
    {id: 'bottom-left', title: '左下', group: 'corners', accelerator: binding('<Shift>Down'), layouts: [fraction(0, 1 / 2, 1 / 2, 1 / 2), fraction(0, 1 / 2, 2 / 3, 1 / 2), fraction(0, 1 / 2, 1 / 3, 1 / 2)]},
    {id: 'bottom-right', title: '右下', group: 'corners', accelerator: binding('<Shift>Up'), layouts: [fraction(1 / 2, 1 / 2, 1 / 2, 1 / 2), fraction(1 / 3, 1 / 2, 2 / 3, 1 / 2), fraction(2 / 3, 1 / 2, 1 / 3, 1 / 2)]},
    {id: 'left-third', title: '左1/3', group: 'thirds', accelerator: binding('1'), layouts: [fraction(0, 0, 1 / 3, 1)]},
    {id: 'center-third', title: '中央1/3（横）', group: 'thirds', accelerator: binding('2'), layouts: [fraction(1 / 3, 0, 1 / 3, 1)]},
    {id: 'right-third', title: '右1/3', group: 'thirds', accelerator: binding('3'), layouts: [fraction(2 / 3, 0, 1 / 3, 1)]},
    {id: 'left-two-thirds', title: '左2/3', group: 'thirds', accelerator: binding('4'), layouts: [fraction(0, 0, 2 / 3, 1)]},
    {id: 'right-two-thirds', title: '右2/3', group: 'thirds', accelerator: binding('5'), layouts: [fraction(1 / 3, 0, 2 / 3, 1)]},
    {id: 'top-third', title: '上1/3', group: 'vertical-thirds', layouts: [fraction(0, 0, 1, 1 / 3)]},
    {id: 'middle-third', title: '中央1/3（縦）', group: 'vertical-thirds', layouts: [fraction(0, 1 / 3, 1, 1 / 3)]},
    {id: 'bottom-third', title: '下1/3', group: 'vertical-thirds', layouts: [fraction(0, 2 / 3, 1, 1 / 3)]},
    {id: 'top-two-thirds', title: '上2/3', group: 'vertical-thirds', layouts: [fraction(0, 0, 1, 2 / 3)]},
    {id: 'bottom-two-thirds', title: '下2/3', group: 'vertical-thirds', layouts: [fraction(0, 1 / 3, 1, 2 / 3)]},
    {id: 'next-third', title: '次の1/3領域へ', group: 'third-cycle', accelerator: binding('period')},
    {id: 'previous-third', title: '前の1/3領域へ', group: 'third-cycle', accelerator: binding('comma')},
    {id: 'larger', title: '大きくする', group: 'other', accelerator: binding('equal')},
    {id: 'smaller', title: '小さくする', group: 'other', accelerator: binding('minus')},
    {id: 'previous-monitor', title: '前のディスプレイへ', group: 'other', accelerator: binding('Page_Up')},
    {id: 'next-monitor', title: '次のディスプレイへ', group: 'other', accelerator: binding('Page_Down')},
    {id: 'undo', title: '元に戻す', group: 'other', accelerator: binding('z')},
    {id: 'redo', title: 'やり直す', group: 'other', accelerator: binding('<Shift>z')},
].map(action => ({...action, key: `atlas-${action.id}`}));

export const ACTION_BY_ID = new Map(ACTIONS.map(action => [action.id, action]));

// Original Spectacle defaults, with Command → Super and Option → Alt.
// Additional Ubuntu-only actions are deliberately unassigned in this preset.
const spectacleBindings = {
    center: '<Alt><Super>c',
    maximize: '<Alt><Super>f',
    'left-half': '<Alt><Super>Left',
    'right-half': '<Alt><Super>Right',
    'top-half': '<Alt><Super>Up',
    'bottom-half': '<Alt><Super>Down',
    'top-left': '<Control><Super>Left',
    'bottom-left': '<Control><Shift><Super>Left',
    'top-right': '<Control><Super>Right',
    'bottom-right': '<Control><Shift><Super>Right',
    'next-monitor': '<Control><Alt><Super>Right',
    'previous-monitor': '<Control><Alt><Super>Left',
    'next-third': '<Control><Alt>Right',
    'previous-third': '<Control><Alt>Left',
    larger: '<Control><Alt><Shift>Right',
    smaller: '<Control><Alt><Shift>Left',
    undo: '<Alt><Super>z',
    redo: '<Alt><Shift><Super>z',
};

export const SHORTCUT_PRESETS = [
    {id: 'ubuntu', title: 'Ubuntu向け初期値', description: 'Super + Ctrl + Alt を基本にした配列',
        bindings: Object.fromEntries(ACTIONS.map(action => [action.key, action.accelerator ? [action.accelerator] : []]))},
    {id: 'spectacle', title: 'Spectacle配列', description: '本家のCommandをSuper、OptionをAltに置き換えます',
        bindings: Object.fromEntries(ACTIONS.map(action => [action.key, spectacleBindings[action.id] ? [spectacleBindings[action.id]] : []]))},
];
