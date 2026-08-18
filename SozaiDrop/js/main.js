window.onerror = function (msg, src, line) {
    var el = document.getElementById('status');
    if (el) {
        el.textContent = 'JSエラー: ' + msg + ' (' + String(src || '').split('/').pop() + ':' + line + ')';
        el.className = 'error';
    }
};

var cs = new CSInterface();
var nreq = (typeof require === 'function') ? require : (window.cep_node && window.cep_node.require);
if (!nreq) throw new Error('Node.jsが無効です（manifestの--enable-nodejsが効いていません。Premiere再起動が必要）');
var fs = nreq('fs');
var pathMod = nreq('path');
var os = nreq('os');
var cp = nreq('child_process');

var BASE = pathMod.join(os.homedir(), 'Library', 'Application Support', 'SozaiDrop');
var SETTINGS_PATH = pathMod.join(BASE, 'settings.json');

var KIND_BY_EXT = {};
['.wav', '.mp3', '.aif', '.aiff', '.m4a', '.ogg', '.flac'].forEach(function (e) { KIND_BY_EXT[e] = 'audio'; });

var settings = { folders: [], tags: {}, prefs: {} };
var items = [];
// 絞り込みは「①種類 kindSel → ②場所 src → ③ license/scene/sub」の3段。
// ③はフォルダ階層をそのまま出さず、パスから読み替えた3つのタグ（itemTags）で絞る。
// license/scene/sub の意味は src によって変わる（project=ビン名／folder=場面名）ので、
// src を切り替えたときは必ず3つとも空に戻す（setSrc）
var filter = { license: '', scene: '', sub: '', search: '', kindSel: '', src: 'folder' };
var previewAudio = new Audio();
var hoverTimer = null;
var tagEditPath = null;
var checkedPaths = {};
var checkMode = false;
// ①②③の絞り込みを畳んでいるか（畳むと④の一覧が約116px＝3行ぶん広がる）。次に開いたときも同じ状態で出す
var filtersCollapsed = false;

// 記号だけのボタン（⚙・▲）に文字ラベルも出せる幅の下限。これより細いパネルでは記号だけに落とす
//（無理に文字を出すと下の操作列が2行に折り返して、広げたはずの一覧をまた食い潰す）。
// 360＝実測でフッターの4つが1行に収まる下限。320＝④の見出しが「クリック挿入」を押し出さない下限
var SETTINGS_LABEL_MIN_W = 360;
var FILTER_LABEL_MIN_W = 320;
// 挿入先メニューを「⚙設定の上」に開くために最低限ほしい高さ。ここを割ると⚙設定にかぶせてでも高さを取る
var TRACK_MENU_MIN_H = 160;

// ── 設定 ──────────────────────────────────

function normDir(p) {
    // ルート「/」だけは末尾スラッシュを外すと空文字になり、登録フォルダ名（＝場面名）が
    // 空になってしまうため、'/' のまま残す
    var s = String(p).replace(/\/+$/, '');
    return s || '/';
}

// 設定ファイルは手で編集されて壊れることがあるので、期待した形かどうかを毎回確かめる
function isPlainObj(o) {
    return !!o && typeof o === 'object' && !Array.isArray(o);
}

// macOSのファイル名は濁点分解(NFD)で返るため、検索・パス比較は必ずNFC正規化して行う
function nfc(s) {
    s = String(s);
    try { s = s.normalize('NFC'); } catch (e) {}
    return s;
}

// tags/usageのキーはNFC正規化パスに統一する（fs走査=NFDとPremiereの返答=NFCで
// 同じファイルが別キーに割れるのを防ぐ）。旧データもここで1回だけ移行される
function nfcKeys(obj, sum) {
    var out = {};
    Object.keys(obj).forEach(function (k) {
        var n = nfc(k);
        if (out[n] === undefined) out[n] = obj[k];
        else if (sum && typeof obj[k] === 'number') out[n] += obj[k];
    });
    return out;
}

// ファイルを読んでオブジェクトを返す（読めない・壊れている・ファイル無しは null）
function readSettingsFile(p) {
    try {
        var obj = JSON.parse(fs.readFileSync(p, 'utf8'));
        // folders が配列でないファイルは「読めた」と扱わない（壊れ扱いにして .bak 復旧へ回す）
        if (isPlainObj(obj) && (obj.folders === undefined || Array.isArray(obj.folders))) return obj;
    } catch (e) {}
    return null;
}

// 設定読み込みで壊れを検知した場合の警告文（起動時に表示）
var settingsLoadWarning = '';
// 保存に失敗したまま走査完了メッセージで警告が消えるのを防ぐための持ち越しフラグ
var settingsSaveWarning = '';
// 持ち越した警告を後続メッセージの末尾に足すときの文言（走査完了・自動タグ・挿入で共用）
var SAVE_WARN_SUFFIX = '（ただし設定を保存できませんでした。次に開くと元に戻ります）';

function loadSettings() {
    var loaded = readSettingsFile(SETTINGS_PATH);
    if (!loaded) {
        var mainExists = false;
        try { mainExists = fs.existsSync(SETTINGS_PATH); } catch (e) {}
        // 本体が壊れていたら前回保存の .bak から復旧（空設定での上書き確定を防ぐ）
        var bak = readSettingsFile(SETTINGS_PATH + '.bak');
        if (bak) {
            loaded = bak;
            settingsLoadWarning = '設定ファイルが壊れていたためバックアップから復旧しました（タグ・使用回数は保持）';
        } else if (mainExists) {
            // 本体もバックアップも読めない：壊れた生ファイルを退避して手動復旧できるよう温存
            try { fs.renameSync(SETTINGS_PATH, SETTINGS_PATH + '.corrupt-' + Date.now()); } catch (e) {}
            settingsLoadWarning = '設定ファイルが壊れていました。壊れたファイルは .corrupt として残し、空の設定で起動しました';
        }
    }
    if (isPlainObj(loaded)) settings = loaded;
    // 中身の型が期待どおりでない（手で書き換えた・別バージョンが書いた）ときも
    // 起動だけはできるように、おかしい項目は空として受け直す
    settings.folders = (Array.isArray(settings.folders) ? settings.folders : []).map(normDir)
        // ドライブ全体が入っているとPC中を走査してしまう（addFolderと同じ関門を読み込み側にも置く）
        .filter(function (r) { return r !== '/'; });
    settings.tags = nfcKeys(isPlainObj(settings.tags) ? settings.tags : {});
    // 値が配列でないタグ（手で書き換えた・別バージョンが書いた）は捨てる。残すと
    // 検索の tags.join(' ') とタグ編集画面の join(', ') で落ち、描画ごと止まる
    Object.keys(settings.tags).forEach(function (k) {
        if (!Array.isArray(settings.tags[k])) delete settings.tags[k];
    });
    settings.usage = nfcKeys(isPlainObj(settings.usage) ? settings.usage : {}, true);
    // 数値でない使用回数も捨てる（"abc" のまま bumpUsage で 'abc1' に伸び続け、★の並びが壊れる）
    Object.keys(settings.usage).forEach(function (k) {
        var u = settings.usage[k];
        if (typeof u !== 'number' || !isFinite(u)) delete settings.usage[k];
    });
    settings.dur = nfcKeys(isPlainObj(settings.dur) ? settings.dur : {});
    // 旧版が保存した失敗マーク（-1等）は捨てて再計測対象に戻す
    Object.keys(settings.dur).forEach(function (k) {
        if (!(settings.dur[k] > 0)) delete settings.dur[k];
    });
    settings.kindOverride = nfcKeys(isPlainObj(settings.kindOverride) ? settings.kindOverride : {});
    settings.prefs = isPlainObj(settings.prefs) ? settings.prefs : {};
    // 畳み状態のキーは groupKey() が最初からNFCで作るのでnfcKeysは不要。入れ物の型だけ見る
    settings.collapsed = isPlainObj(settings.collapsed) ? settings.collapsed : {};
}

// 書き込み中クラッシュで半端JSONが残り全タグ・使用回数が無言消失するのを防ぐため、
// 一時ファイルへ書いてから rename で原子的に差し替える。直前の内容は .bak に1世代保持する
// 保存に失敗（ディスク満杯・権限なし等）しても例外は外へ出さない。ここで投げると
// 呼び出し元の render() まで巻き添えで止まり、画面が丸ごと反応しなくなるため
function saveSettings() {
    try {
        fs.mkdirSync(BASE, { recursive: true });
        var tmp = SETTINGS_PATH + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(settings, null, 1));
        try {
            if (fs.existsSync(SETTINGS_PATH)) fs.renameSync(SETTINGS_PATH, SETTINGS_PATH + '.bak');
        } catch (e) {}
        fs.renameSync(tmp, SETTINGS_PATH);
        settingsSaveWarning = '';
        return true;
    } catch (e) {
        settingsSaveWarning = '1';
        showStatus('設定を保存できませんでした（表示は変わりますが、次に開くと元に戻ります）', 'error');
        return false;
    }
}

// 成功メッセージの出し方（保存を伴う操作の共通作法）。
// 保存に失敗したとき、成功メッセージを消すと「保存できていない」ことに気づけない。
// 逆に成功メッセージで塗り潰すと「保存できた」と誤解する。だから消さずに末尾へ足す。
// 呼ぶ順は必ず saveSettings() → この関数（saveSettingsが出した赤字をここで置き換える）
function showStatusWithSaveWarning(msg) {
    if (settingsSaveWarning) {
        showStatus(msg + SAVE_WARN_SUFFIX, 'error');
        settingsSaveWarning = '';
        return;
    }
    showStatus(msg, 'success');
}

// ── スキャン ──────────────────────────────

function walk(dir, root, depth, out) {
    if (depth > 6) return;
    var names;
    // 読めないフォルダは黙って飛ばす（権限なし等）。登録フォルダそのものが消えている
    // 場合はここでは分からないので、rescanRun() が root ごとに実在を確かめる
    try { names = fs.readdirSync(dir); } catch (e) { return; }
    names.forEach(function (name) {
        if (name.charAt(0) === '.') return;
        var full = pathMod.join(dir, name);
        var st;
        try { st = fs.statSync(full); } catch (e) { return; }
        if (st.isDirectory()) { walk(full, root, depth + 1, out); return; }
        var ext = pathMod.extname(name).toLowerCase();
        var kind = KIND_BY_EXT[ext];
        if (!kind) return;
        // sub は pathN と同じNFC基準で切り出す（素のpath.relativeだとルートがNFC・
        // 子がNFDのときに '../…' になり、③に意味不明な場面名が出るため）
        out.push({
            path: full, name: name, ext: ext, kind: kind,
            nameN: nfc(name).toLowerCase(), pathN: nfc(full),
            root: root, sub: pathMod.dirname(nfc(full).slice(nfc(root).length + 1)),
            mtime: st.mtimeMs
        });
    });
}

// 「更新」で何件増えた/減ったかを言うための、前回スキャン時のPCフォルダ素材数
var lastFolderCount = null;

function refreshMsg(diff) {
    if (diff === null) return '更新しました';
    if (diff > 0) return '更新しました（PCフォルダの素材が ' + diff + ' 件増えました）';
    if (diff < 0) return '更新しました（PCフォルダの素材が ' + (-diff) + ' 件減りました）';
    return '更新しました（PCフォルダの増減はありません）';
}

// プロジェクト走査は非同期なので、応答前に「素材がありません」と誤案内しないよう状態を持つ
var projectScan = 'loading';

// 走査の世代番号。⟳を連打すると走査が二重に走り、先に始めた古い走査の応答が
// あとから届いて新しい結果を上書きしてしまうため、最新の走査の応答だけを採用する
var scanSeq = 0;
var scanTimer = null;
// 応答が返らないまま⟳が押せなくなるのを防ぐ保険（実機は数秒で返る）
var RESCAN_TIMEOUT_MS = 15000;
// 応答なしの案内は保険タイマーと本応答の両方から出るので、文言は1か所にまとめる
var NO_PROJECT_RESPONSE_MSG = 'プロジェクト内を読み取れませんでした（Premiereからの応答がありません）';

// 登録フォルダ自体が見つからないときの案内（空文字＝全部見つかっている）。
// ステータスと④の空メッセージの両方から使う
var missingRootsMsg = '';

function missingRootsMessage(roots) {
    if (roots.length === 0) return '';
    // 名前の作り方は登録フォルダの表示名と同じ（同名ルートには親名が付く）
    return '登録フォルダが見つかりません：' + roots.map(function (r) {
        return '「' + rootLabel(r) + '」';
    }).join('') + '（外付けドライブが外れていませんか）';
}

function setRescanBusy(busy) {
    var btn = document.getElementById('btnRescan');
    if (btn) btn.disabled = busy;
}

// reportDiff=true は「更新」ボタン用。前回との件数差をメッセージにする
function rescan(doneMsg, reportDiff) {
    if (typeof doneMsg !== 'string') doneMsg = '';
    var my = ++scanSeq;
    clearTimeout(scanTimer);
    setRescanBusy(true);
    // 走査（rescanRun）は同期処理で、素材が多いと数秒画面が止まる。押した直後に
    // 「押せない見た目」と「読み込み中」を先に描かせてから走査を始める
    showStatus('読み込み中...', '');
    scanTimer = setTimeout(function () {
        if (my !== scanSeq) return;
        setRescanBusy(false);
        // もう待っていないので「確認中」の表示も畳む。遅れて本物の応答が届いたら
        // 下のコールバックが正しい結果で上書きするので、回復はする
        projectScan = 'error';
        // ③は走査の1段目で「選択を残したまま」作り直しているので、ここで作り直さないと
        // 消えた場面を選んだまま（プルダウンは「すべて」と出ているのに④が0件）で固まる。
        // 応答が来たときの経路（下の buildTagFilters()）と同じく、残さずに作り直す
        buildTagFilters();
        render();
        showStatus(NO_PROJECT_RESPONSE_MSG, 'error');
    }, RESCAN_TIMEOUT_MS);
    setTimeout(function () {
        // 待っている間に新しい走査が始まっていたら、同じ走査を二重に走らせない
        if (my === scanSeq) rescanRun(my, doneMsg, reportDiff);
    }, 0);
}

// 走査の本体。上の描画を1回挟んでから呼ばれる（保険タイマーと世代番号は rescan() 側が持つ）
function rescanRun(my, doneMsg, reportDiff) {
    var scanned = [];
    var missing = [];
    settings.folders.forEach(function (root) {
        // 外付けドライブを外した・フォルダを移動/リネームしたときは walk() が
        // 例外を飲んで0件になり、原因が形式の話に見えてしまう。root ごとに実在を見る。
        // 1つ見つからなくても、残りの登録フォルダは今までどおり走査する
        var exists = false;
        try { exists = fs.existsSync(root); } catch (e) {}
        if (!exists) { missing.push(root); return; }
        walk(root, root, 0, scanned);
    });
    missingRootsMsg = missingRootsMessage(missing);
    // 親フォルダと子フォルダを両方登録していると同じファイルを2回拾い、
    // ③の件数も「更新」の増減件数も水増しされるためパスで1本化する
    var folderItems = [];
    var seenPath = {};
    scanned.forEach(function (it) {
        if (seenPath[it.pathN]) return;
        seenPath[it.pathN] = true;
        folderItems.push(it);
    });
    var diff = (lastFolderCount === null) ? null : folderItems.length - lastFolderCount;
    lastFolderCount = folderItems.length;
    if (reportDiff) doneMsg = refreshMsg(diff);
    // プロジェクト走査の応答を待たずにフォルダ素材を先に描画する
    projectScan = 'loading';
    items = folderItems;
    items.forEach(function (it, i) { it.i = i; });
    buildTagFilters(true);
    render();
    showStatus((doneMsg ? doneMsg + ' ／ ' : '') + folderItems.length + ' 件読み込み。プロジェクト内を確認中...', '');
    cs.evalScript('sdListProjectAudio()', function (result) {
        // 自分より新しい走査が始まっていたら、古い結果で画面を書き換えない
        if (my !== scanSeq) return;
        clearTimeout(scanTimer);
        setRescanBusy(false);
        // Premiereのビン構成と1対1で一致させるため重複排除はしない
        var pItems = [];
        var errMsg = '';
        if (!result || result === 'undefined') {
            errMsg = NO_PROJECT_RESPONSE_MSG;
        } else if (result.indexOf('ERR:') === 0) {
            errMsg = 'プロジェクト内を読み取れませんでした: ' + result.slice(4);
        } else if (result !== 'EMPTY') {
            result.split(String.fromCharCode(1)).forEach(function (rec) {
                var f = rec.split(String.fromCharCode(2));
                if (f.length < 3) return;
                pItems.push({
                    path: f[2], name: f[1], ext: pathMod.extname(f[2]).toLowerCase(),
                    nameN: nfc(f[1]).toLowerCase(), pathN: nfc(f[2]),
                    kind: 'audio', root: '__project__', sub: f[0] || '.', mtime: 0
                });
            });
        }
        projectScan = errMsg ? 'error' : 'ok';
        items = folderItems.concat(pItems);
        items.sort(function (a, b) { return a.name.localeCompare(b.name, 'ja'); });
        items.forEach(function (it, i) { it.i = i; });
        buildTagFilters();
        render();
        var msg = items.length + ' 件の素材を読み込みました';
        if (pItems.length > 0) msg += '（うちプロジェクト内 ' + pItems.length + ' 件）';
        // 完了メッセージを消さず末尾に足す（走査が終わったことも保存が失敗したことも両方伝えるため）
        var saveWarn = settingsSaveWarning ? SAVE_WARN_SUFFIX : '';
        // 設定ファイル破損の警告があれば読み込み完了より優先して表示（1回のみ）
        if (settingsLoadWarning) {
            showStatus(settingsLoadWarning + saveWarn, 'error');
            settingsLoadWarning = '';
        } else if (errMsg) {
            showStatus(errMsg + saveWarn, 'error');
        } else if (missingRootsMsg) {
            // 登録フォルダが見えていないことは件数の報告より先に伝える
            // （0件の理由がドライブ側にあるのに、形式や登録の話に見えてしまうため）
            showStatus(missingRootsMsg + saveWarn, 'error');
        } else {
            showStatus((doneMsg ? doneMsg + ' ／ ' : '') + msg + saveWarn, saveWarn ? 'error' : 'success');
        }
        settingsSaveWarning = '';
        probeDurations();
    });
}

// 案内文の中でボタンを名指しするときは、画面に出ているその文字をそのまま使う。
// 直書きすると、ボタンの文言を変えたときに案内だけ古いまま残る（＝⋯へ畳んだ 2026-08-09 に
// 「＋フォルダ」「−フォルダ」「🏷自動」という無くなった名前を指し続けた事故。二度と直書きしない）。
// 見つからないときだけ id を返す（案内が空文字になって意味不明になるより、手がかりが残るほうがまし）
function btnName(id) {
    var b = document.getElementById(id);
    var t = b ? String(b.textContent || '').replace(/\s+/g, ' ').trim() : '';
    return t || id;
}

// 「⋯」の中に畳んだ操作を名指しするときの言い方（どこを開けばあるのかまで書く）
function moreItem(id) {
    return '「' + btnName('btnMore') + '」の中の「' + btnName(id) + '」';
}

// フォルダ選択ダイアログ。選ばなかったときは空文字（フォルダの登録と解除で共用）
function chooseFolder(title) {
    var result = window.cep.fs.showOpenDialog(false, true, title, '');
    if (result.err !== 0 || !result.data || result.data.length === 0) return '';
    var raw = result.data[0];
    return normDir((raw.indexOf('file://') === 0) ? decodeURIComponent(raw.replace(/^file:\/\//, '')) : raw);
}

function addFolder() {
    var folder = chooseFolder('素材フォルダを選択');
    if (!folder) return;
    // ディスク全体を登録するとPC中を走査するうえ、③の絞り込みが全素材に一致して機能しなくなる
    // （断るときは ⋯ を開けたままにする＝そのまま選び直せる）
    if (folder === '/') {
        showStatus('ドライブ全体は登録できません', 'error');
        return;
    }
    // 選び直しの余地が無いところまで来た＝⋯ の用は済んだので閉じる。
    // 開けっぱなしだと、結果の案内（下段）に一覧ごとかぶって見えないことがある
    hidePopup('moreMenu');
    // 重複判定だけNFCで行う（濁点分解の違いで同じフォルダが二重登録されるのを防ぐ）。
    // 保存する文字列は実ファイルアクセスに使うので正規化しないこと
    var folderN = nfc(folder);
    var dup = null;
    settings.folders.forEach(function (r) { if (nfc(r) === folderN) dup = r; });
    // すでに登録済みなら読み込み直しても結果は変わらない。押した意味が分かるよう案内だけ出す
    // （表示名は登録済みのほうから作る＝濁点分解の違いで見分け方がぶれないため）
    if (dup) {
        showStatus('「' + rootLabel(dup) + '」はすでに登録されています', '');
        return;
    }
    settings.folders.push(folder);
    // 保存より先に読み込み直す（保存に失敗しても、いま登録したフォルダは一覧に出す）
    rescan('「' + rootLabel(folder) + '」を登録しました');
    saveSettings();
}

// arm確認メッセージのタイムアウト消去は、その後に別のメッセージが出ていたら何もしない
// （挿入結果など無関係な表示を巻き添えで消さないため）
function clearStatusIf(msg) {
    var el = document.getElementById('status');
    if (el.textContent === msg) { el.textContent = ''; el.className = ''; }
}

// フォルダ登録解除（誤操作防止のため、2回押したときだけ実行する）
var removeArmedRoot = null;
// ダイアログで実際に選ばれたフォルダ（登録フォルダの中のサブフォルダかもしれない）。
// 2回目の押下でダイアログを出し直さないよう覚えておく
var removeArmedPicked = '';
var removeArmedTimer = null;
var removeArmedMsg = '';

function disarmRemove(clearMsg) {
    removeArmedRoot = null;
    removeArmedPicked = '';
    clearTimeout(removeArmedTimer);
    document.getElementById('btnRemoveFolder').classList.remove('arm');
    if (clearMsg) clearStatusIf(removeArmedMsg);
}

// 解除するフォルダは③では選べなくなった（③はフォルダではなく場面で絞るため）ので、
// 登録と同じ選択ダイアログで名指ししてもらう。2回目の押下ではもう出さない
function removeFolder() {
    if (settings.folders.length === 0) {
        showStatus('登録されている素材フォルダがありません（先に' + moreItem('btnAddFolder') + 'で登録してください）', 'error');
        return;
    }
    var root = removeArmedRoot;
    var f = removeArmedPicked;
    if (!root) {
        f = chooseFolder('登録を解除するフォルダを選択');
        if (!f) return;
        // 親子フォルダを両方登録している場合に親を誤って解除しないよう最長一致で選ぶ。
        // ダイアログの返す文字列と登録済みの文字列は濁点分解が違うことがあるのでNFCで見る
        var fN = nfc(f);
        settings.folders.forEach(function (r) {
            var rN = nfc(r);
            if ((fN === rN || fN.indexOf(rN + '/') === 0) && (!root || r.length > root.length)) root = r;
        });
        if (!root) {
            // 断るだけだと「じゃあ何が登録されているのか」を思い出す手がかりが無いので、
            // いま登録中のフォルダ名も一緒に出す（多いときは REGISTERED_LIST_MAX 件で打ち切る）
            showStatus('「' + pathMod.basename(f) + '」は登録フォルダではありません（登録したフォルダかその中を選んでください）。いま登録中：' + registeredRootsText(), 'error');
            return;
        }
    }
    if (removeArmedRoot === root) {
        disarmRemove(false);
        // 2回目＝確定。赤い確定待ちはもう無いので ⋯ を開けておく理由も無い
        hidePopup('moreMenu');
        // 表示名（同名ルートには親名が付く）は登録一覧から作るので、外す前に確定させる
        var label = rootLabel(root);
        settings.folders.splice(settings.folders.indexOf(root), 1);
        // 解除したフォルダ配下のタグ・使用回数も掃除する（ゴーストタグ防止）。
        // ただし親フォルダなど残りの登録フォルダから今後も見えるファイルの分は残す
        var rootN = nfc(root) + '/';
        var remaining = settings.folders.map(function (r) { return nfc(r) + '/'; });
        [settings.tags, settings.usage].forEach(function (m) {
            Object.keys(m).forEach(function (k) {
                if (k.indexOf(rootN) !== 0) return;
                var covered = remaining.some(function (p) { return k.indexOf(p) === 0; });
                if (!covered) delete m[k];
            });
        });
        saveSettings();
        // 解除で消える場面を選んだままにしない（rescan後の buildTagFilters が「すべて」に戻す）
        rescan('「' + label + '」の登録を解除しました（ファイル自体は消えません）');
        return;
    }
    removeArmedRoot = root;
    removeArmedPicked = f;
    clearTimeout(removeArmedTimer);
    document.getElementById('btnRemoveFolder').classList.add('arm');
    removeArmedTimer = setTimeout(function () { disarmRemove(true); }, 4000);
    // ダイアログでサブフォルダを選ぶと、解除されるのは最長一致の親（＝登録フォルダ）になる。
    // 選んだものと対象が食い違うので、そのときだけ何が外れるかを名指しで断る
    var again = ' → もう一度「' + btnName('btnRemoveFolder') + '」を押すと解除';
    removeArmedMsg = (nfc(f) === nfc(root))
        ? '「' + rootLabel(root) + '」の登録を解除しますか？' + again
        : '「' + pathMod.basename(f) + '」は登録フォルダそのものではありません。親の「' +
            rootLabel(root) + '」ごと解除しますか？（ファイルは消えません）' + again;
    showStatus(removeArmedMsg, '');
}

// 未タグの素材に辞書（autotag.js）でタグを付ける。手動で付けたタグは変更しない。
// 一括書き込みのため2回押しで確定（1回目は対象件数の予告のみ）
var autoTagArmed = false;
var autoTagTimer = null;
var autoTagArmedMsg = '';

function disarmAutoTag(clearMsg) {
    autoTagArmed = false;
    clearTimeout(autoTagTimer);
    document.getElementById('btnAutoTag').classList.remove('arm');
    if (clearMsg) clearStatusIf(autoTagArmedMsg);
}

function autoTagTargets() {
    var seen = {};
    var targets = [];
    items.forEach(function (it) {
        var key = it.pathN || nfc(it.path);
        if (seen[key]) return;
        seen[key] = true;
        if ((settings.tags[key] || []).length > 0) return;
        var tags = sdAutoTags(it.name);
        if (tags.length > 0) targets.push({ key: key, tags: tags });
    });
    return targets;
}

function autoTagAll() {
    if (typeof sdAutoTags !== 'function') {
        showStatus('自動タグ辞書（autotag.js）が読み込まれていません', 'error');
        return;
    }
    var targets = autoTagTargets();
    if (targets.length === 0) {
        disarmAutoTag(false);
        showStatus('自動タグを付けられる素材はありませんでした（辞書に無い名前）', '');
        return;
    }
    if (!autoTagArmed) {
        autoTagArmed = true;
        clearTimeout(autoTagTimer);
        document.getElementById('btnAutoTag').classList.add('arm');
        autoTagTimer = setTimeout(function () { disarmAutoTag(true); }, 4000);
        autoTagArmedMsg = targets.length + '件に自動タグが付きます → もう一度「' + btnName('btnAutoTag') +
            '」を押すと実行（手動タグは変更しません）';
        showStatus(autoTagArmedMsg, '');
        return;
    }
    disarmAutoTag(false);
    // 2回目＝確定。赤い確定待ちが終わったので ⋯ も閉じる
    hidePopup('moreMenu');
    targets.forEach(function (t) { settings.tags[t.key] = t.tags; });
    clearTagCache();
    // 数百件を一度に書く最大の書き込み。保存できていないことを緑の成功表示で隠さない
    saveSettings();
    render();
    showStatusWithSaveWarning(targets.length + '件に自動タグを付けました');
}

// ── 効果音/BGMの見分け ──────────────────────
// ①手動指定（タグ編集画面の種別ボタン）②フォルダ名・ファイル名 ③曲の長さ（60秒以上=BGM）
// の順で判定する。どれでも分からないものは効果音扱い（長さが測れ次第自動で直る）

// 判定はパス丸ごとではなく「ファイル名→近いフォルダ名」の順（深い階層優先）。
// ~/Music などの遠い親フォルダ名で配下の効果音が全部BGM扱いになるのを防ぐ
var SEG_SE_RE = /効果音|sfx|ジングル|jingle|^se$|^se[_\-. ]|[_\-. ]se$/;
var SEG_BGM_RE = /bgm|music|ミュージック|サウンドトラック|soundtrack|劇伴|instrumental/;
var BGM_DUR_SEC = 60;

function kindByName(key) {
    var segs = key.toLowerCase().split('/');
    for (var i = segs.length - 1; i >= 0; i--) {
        var s = segs[i];
        // ファイル名は拡張子を外して判定（「〜_se.wav」の末尾seを拾えるように）
        if (i === segs.length - 1) s = s.replace(/\.[^.]+$/, '');
        if (SEG_SE_RE.test(s)) return 'se';
        if (SEG_BGM_RE.test(s)) return 'bgm';
    }
    return '';
}

// 1回の描画で同じ素材の判定を何度も計算しないための覚え書き。
// 判定材料（手動指定・曲長）が変わる操作は必ず描画をやり直すので、
// render()/buildTagFilters() の頭で作り直せば古い判定は残らない
var kindMemo = {};

function audioKind(it) {
    var key = it.pathN || nfc(it.path);
    if (kindMemo[key] !== undefined) return kindMemo[key];
    var k;
    if (settings.kindOverride[key]) k = settings.kindOverride[key];
    else {
        var byName = kindByName(key);
        var d = settings.dur[key];
        if (byName) k = byName;
        else if (typeof d === 'number' && d > 0) k = (d >= BGM_DUR_SEC ? 'bgm' : 'se');
        else k = 'se';
    }
    kindMemo[key] = k;
    return k;
}

// 名前で判定できない素材の長さをバックグラウンドで計測してキャッシュする（同時4件）。
// 計測失敗（オフライン・タイムアウト等）は保存せずセッション内でのみ再試行を止める＝
// 次回起動時に自動で再計測される（一時要因で永久に誤分類しないため）
var probing = false;
var probeRerun = false;
var probeFailed = {};

function probeDurations() {
    if (probing) { probeRerun = true; return; }
    var pending = [];
    var seen = {};
    items.forEach(function (it) {
        var key = it.pathN || nfc(it.path);
        if (seen[key]) return;
        seen[key] = true;
        if (settings.kindOverride[key] || kindByName(key)) return;
        if (settings.dur[key] !== undefined || probeFailed[key]) return;
        pending.push({ key: key, path: it.path });
    });
    if (pending.length === 0) return;
    probing = true;
    var i = 0, active = 0, changed = false;
    function next() {
        while (active < 4 && i < pending.length) probe(pending[i++]);
        if (active === 0 && i >= pending.length) {
            probing = false;
            if (changed) {
                saveSettings();
                // 長さで効果音↔BGMの分類が変わるため、③の項目と件数も作り直す
                buildTagFilters(filter.src === 'project' && projectScan !== 'ok');
                render();
            }
            // 計測中に再スキャンが来ていたら、新規素材ぶんをもう一度計測する
            if (probeRerun) {
                probeRerun = false;
                probeDurations();
            }
        }
    }
    function probe(p) {
        active++;
        var a = new Audio();
        var done = false;
        function fin(d) {
            if (done) return;
            done = true;
            if (d > 0) {
                settings.dur[p.key] = d;
                changed = true;
            } else {
                probeFailed[p.key] = 1;
            }
            active--;
            a.removeAttribute('src');
            a.load();
            next();
        }
        a.preload = 'metadata';
        a.onloadedmetadata = function () { fin(isFinite(a.duration) ? a.duration : -1); };
        a.onerror = function () { fin(-1); };
        setTimeout(function () { fin(-1); }, 8000);
        a.src = fileUrl(p.path);
    }
    next();
}

// ── フィルタUI ─────────────────────────────

// ①種類の絞り込みだけを通したか（③の件数表示に使う。検索語は入れない＝
// 打つたびに件数が動くと、場面を選ぶ手がかりにならないため）
function kindPass(it) {
    return !filter.kindSel || audioKind(it) === filter.kindSel;
}

// ビンに入っていないプロジェクト素材の場面名（「すべて」と紛れない言い方にする）
var PROJECT_ROOT_SCENE = 'プロジェクト直下';

// 素材1件を「フリー/楽曲・場面・内訳」の3タグに読み替える。
// 実フォルダは「場面/フリー」「フリー/場面」「登録フォルダ丸ごとフリー」が混在していて
// 階層の深さに意味が無いため、フォルダ構成をそのまま出さずここで意味に変換する。
// 結果は素材ごとに覚えておく（走査のたびにitemsを作り直すので古いまま残らない）
function itemTags(it) {
    if (it.tg) return it.tg;
    // it.sub は登録フォルダ（プロジェクト内はビン）からの相対フォルダ。'.' は直下
    var segs = (it.sub && it.sub !== '.') ? nfc(it.sub).split('/') : [];
    var t;
    if (it.root === '__project__') {
        // ビンは並べ方がそのまま意味なので読み替えない（1段目＝場面／2段目以下＝内訳）
        t = {
            license: '',
            scene: segs.length > 0 ? segs[0] : PROJECT_ROOT_SCENE,
            sub: segs.length > 1 ? segs[1] : ''
        };
    } else {
        var rootName = nfc(pathMod.basename(it.root));
        // 「フリー」はどの階層に出ても・登録フォルダ名に入っていても同じ意味に扱う
        var free = rootName.indexOf('フリー') >= 0;
        var rest = [];
        for (var i = 0; i < segs.length; i++) {
            if (segs[i] === 'フリー') { free = true; continue; }
            // 「その他」はフリーの対（＝楽曲）を表す仕切りでしかなく、場面名ではない
            if (segs[i] === 'その他') continue;
            rest.push(segs[i]);
        }
        t = {
            license: free ? 'free' : 'paid',
            // 登録フォルダ直下のファイルは登録フォルダ名そのものが場面（SE/よく使う → よく使う）
            scene: rest.length > 0 ? rest[0] : rootName,
            // 3段目より深いところは内訳にまとめる（これ以上細かく分けても選べないため）
            sub: rest.length > 1 ? rest[1] : ''
        };
    }
    it.tg = t;
    return t;
}

// 登録フォルダの表示名。/A/SE と /B/SE のように末尾の名前が同じときだけ
// 親フォルダ名を添えて見分けられるようにする
function rootLabel(root) {
    var base = pathMod.basename(root);
    var dup = settings.folders.some(function (r) {
        return r !== root && pathMod.basename(r) === base;
    });
    return dup ? base + '（' + pathMod.basename(pathMod.dirname(root)) + '）' : base;
}

// −フォルダで断るときに添える「いま登録中のフォルダ名」。ふだんは2〜7件だが、
// 増えたときに1行が長くなりすぎないよう、この件数で打ち切って残りは数だけ言う
var REGISTERED_LIST_MAX = 5;

function registeredRootsText() {
    var labels = settings.folders.map(function (r) { return '「' + rootLabel(r) + '」'; });
    if (labels.length <= REGISTERED_LIST_MAX) return labels.join('');
    return labels.slice(0, REGISTERED_LIST_MAX).join('') + 'ほか' + (labels.length - REGISTERED_LIST_MAX) + '件';
}

function resetTagFilters() {
    filter.license = '';
    filter.scene = '';
    filter.sub = '';
}

// 3-cの「（内訳なし）」の値。内訳フォルダ（ビン）に入っていない素材だけを選ぶための
// 目印で、フォルダ名・ビン名には使えない「/」を頭に付けて実在の内訳名とぶつからないようにする
// （「直下」という名前のフォルダが本当にあっても、別の項目として並ぶ）
var SUB_NONE = '/直下';
// その受け皿の表示名。実在のフォルダ名にも括弧は使えるので「（内訳なし）（24）」と
// 括弧が二重にならないよう、頭の区切り記号だけで「実在の名前ではない」ことを示す
var SUB_NONE_LABEL = '― 内訳なし';

// ③の呼び名は②場所で変わる（プロジェクト内はフォルダではなくビン）。見出し・0件の案内・
// ホバー説明の3か所で同じ言葉を使うため、決めるのはここ1か所にする
function sceneWord() {
    return (filter.src === 'project') ? 'ビン' : '場面';
}

// ③の項目1つぶんの説明文。ボタン段（3-a）とプルダウン段（3-b・3-c）で言い回しをそろえる
function tagTip(value, label) {
    if (value === SUB_NONE) {
        return '内訳のフォルダ・ビンに入っていない素材だけ表示（この' + sceneWord() + 'の直下にあるもの）';
    }
    return value ? ('「' + label + '」だけ表示') : 'この段では絞り込まない';
}

// 3-aのボタン1個ぶんのHTML。件数はラベルの続きに素で出す（別色にすると選択中の
// 青地でコントラストが落ちるため）。フォルダ名がそのまま値になるので必ずエスケープする
function tagBtn(value, label, count, cur) {
    return '<button class="kf' + (cur === value ? ' on' : '') + '" data-v="' + escAttr(value) +
        '" title="' + escAttr(tagTip(value, label)) + '">' + esc(label) + ' ' + count + '</button>';
}

// 3-b・3-cのプルダウン1項目ぶんの見え方。件数は「ポップ（24）」の形で名前の直後に付ける
// （ボタンと違って選択中の地色が変わらないので、括弧で区切らないと名前と読み分けにくい）。
// 同じ文字を <select> 本体のホバー説明にも出すので、組み立てはここ1か所にする
function tagOptText(label, count) {
    return label + '（' + count + '）';
}

// 3-b・3-cのプルダウン1項目ぶんのHTML
function tagOpt(value, label, count, cur) {
    return '<option value="' + escAttr(value) + '"' + (cur === value ? ' selected' : '') +
        ' title="' + escAttr(tagTip(value, label)) + '">' + esc(tagOptText(label, count)) + '</option>';
}

// プルダウンの中身を組み立てながら「いま選ばれている項目の全文」も覚えておく入れ物。
// 幅が足りないと選択中の文字は右の▼の手前で切れる（<select> には「…」が出ないので
// 切れたことにも気づけない）。この全文を <select> のホバー説明に出して必ず読めるようにする
function tagOptList(cur) {
    return { cur: cur, html: '', curLabel: '' };
}

function tagOptAdd(list, value, label, count) {
    var text = tagOptText(label, count);
    // どの項目とも一致しないときブラウザは先頭を選ぶので、先頭を既定の「いま」にしておく
    if (list.html === '' || list.cur === value) list.curLabel = text;
    list.html += tagOpt(value, label, count, list.cur);
}

// 3-b（場面）・3-c（内訳）はボタン列ではなくプルダウンで選ぶ。場面は20種類前後あり、
// ボタンだと段が何行にも折り返して④の一覧を下へ押し下げてしまうため。
// 中身は「場面の名前だけ」＋3-aで先に絞ったあとの一覧なので長くならない
// （改修前のプルダウンは登録フォルダ7個とサブフォルダ52個の階層をそのまま並べていて
//   約60行あった。そこが使いにくさの原因だったので、同じ形には戻さない）
// 各 <option> に付けた説明はmacOSのネイティブの一覧では出ないため、ホバーで読める説明は
// <select> 本体に付ける（①②と3-aのボタンは1項目ずつ説明が出るので、③だけ無説明にしない）
function tagSelectHtml(id, list, what) {
    return '<select class="fsel" id="' + id + '" title="' +
        escAttr('いま：' + list.curLabel + '／選び直すと' + what + 'を変えられます') +
        '">' + list.html + '</select>';
}

// ③の1行ぶんを差し替える。意味が無い段（フリー/楽曲・内訳）は行ごと隠す。
// 中身が前と同じときは触らない＝プルダウンを開いている最中にプロジェクト走査の応答や
// 曲の長さ計測の完了が届いても、<select> が作り直されて開いた一覧が消えることがない。
// 比べる相手を row.innerHTML にしないのは、ブラウザが読み出すときに selected → selected=""
// のように書き方をそろえてしまい、中身が同じでも必ず食い違って見えるため
function setTagRow(stepId, rowId, html, show) {
    var row = document.getElementById(rowId);
    if (row && row.sdTagHtml !== html) {
        // 作り直すとフォーカスも消えるので、この行の中にあったときだけ戻す
        var hadFocus = row.contains(document.activeElement);
        row.innerHTML = html;
        row.sdTagHtml = html;
        if (hadFocus) {
            var back = row.querySelector('select, button');
            if (back) back.focus();
        }
    }
    var step = document.getElementById(stepId);
    if (step) step.classList.toggle('hidden', !show);
}

// 場面・内訳の並び順。件数の多い順、同数なら名前の五十音順
function tagCmp(count) {
    return function (a, b) { return count[b] - count[a] || a.localeCompare(b, 'ja'); };
}

// ③の絞り込み。①種類と②場所を通った素材だけを母集団にして、
// 実際に存在するタグだけを件数つきで並べる（フォルダ階層はもう出さない）。
// preserve=true はrescan1段目（プロジェクト走査の応答前）用。この時点ではビンの
// 素材がまだ無いので、選択が見つからなくても捨てない
function buildTagFilters(preserve) {
    kindMemo = {};
    // 母集団：②場所で選んでいる側 ∩ ①種類
    var base = [];
    items.forEach(function (it) {
        if ((it.root === '__project__') !== (filter.src === 'project')) return;
        if (kindPass(it)) base.push(it);
    });

    // 3-a フリー/楽曲：PCフォルダのBGMにしかない区別（効果音・プロジェクト内では出さない）
    var showLic = (filter.src === 'folder' && filter.kindSel === 'bgm');
    if (!showLic) filter.license = '';
    var lic = { free: 0, paid: 0 };
    base.forEach(function (it) {
        var l = itemTags(it).license;
        if (l === 'free' || l === 'paid') lic[l]++;
    });
    var licHtml = '';
    if (showLic) {
        licHtml = tagBtn('', 'すべて', base.length, filter.license) +
            tagBtn('free', 'フリー', lic.free, filter.license) +
            tagBtn('paid', '楽曲', lic.paid, filter.license);
    }
    setTagRow('licStep', 'licFilter', licHtml, showLic);

    // 3-b 場面：登録フォルダをまたいで同じ名前は1つに束ねる（ポップはポップで1個）
    var pool2 = [];
    base.forEach(function (it) {
        if (!filter.license || itemTags(it).license === filter.license) pool2.push(it);
    });
    // constructor などの名前の場面で判定が狂わないようプロトタイプ無しの入れ物を使う
    var sceneCount = Object.create(null);
    pool2.forEach(function (it) {
        var s = itemTags(it).scene;
        sceneCount[s] = (sceneCount[s] || 0) + 1;
    });
    // 上の段を変えて選んでいた場面が無くなったら黙って空にせず「すべて」に戻す
    if (!preserve && filter.scene && sceneCount[filter.scene] === undefined) filter.scene = '';
    var sceneList = tagOptList(filter.scene);
    tagOptAdd(sceneList, '', 'すべて', pool2.length);
    Object.keys(sceneCount).sort(tagCmp(sceneCount)).forEach(function (s) {
        tagOptAdd(sceneList, s, s, sceneCount[s]);
    });
    setTagRow('sceneStep', 'sceneFilter', tagSelectHtml('sceneSelect', sceneList, sceneWord()), true);

    // 3-c 内訳：場面を選んでいるときだけ意味を持つ。1種類しか無い（＝すべてと同じ内容に
    // なる）ときは出さない。ただし内訳無しの素材が混ざるなら、分けられるので出す
    var pool3 = [];
    pool2.forEach(function (it) {
        if (!filter.scene || itemTags(it).scene === filter.scene) pool3.push(it);
    });
    var subCount = Object.create(null);
    var noSubCount = 0;
    if (filter.scene) {
        pool3.forEach(function (it) {
            var s = itemTags(it).sub;
            if (!s) { noSubCount++; return; }
            subCount[s] = (subCount[s] || 0) + 1;
        });
    }
    var subs = Object.keys(subCount).sort(tagCmp(subCount));
    var showSub = subs.length >= 2 || (subs.length === 1 && noSubCount > 0);
    if (!preserve) {
        if (!showSub) filter.sub = '';
        else if (filter.sub === SUB_NONE) { if (noSubCount === 0) filter.sub = ''; }
        else if (filter.sub && subCount[filter.sub] === undefined) filter.sub = '';
    }
    var subHtml = '';
    if (showSub) {
        var subList = tagOptList(filter.sub);
        tagOptAdd(subList, '', 'すべて', pool3.length);
        subs.forEach(function (s) { tagOptAdd(subList, s, s, subCount[s]); });
        // 内訳フォルダに入っていない素材（場面の直下）にも行き先を用意する。
        // これが無いとどの項目でも選べず、内訳の件数の合計が「すべて」に届かない。
        // 並びは件数順ではなく必ず最後（実在する内訳名と混ざると探しにくいため）
        if (noSubCount > 0) tagOptAdd(subList, SUB_NONE, SUB_NONE_LABEL, noSubCount);
        subHtml = tagSelectHtml('subSelect', subList, '内訳');
    }
    setTagRow('subStep', 'subFilter', subHtml, showSub);

    // 呼び名は②場所に合わせる（プロジェクト内はフォルダではなくビン）
    var lab = document.getElementById('sceneLabel');
    if (lab) lab.textContent = '③ ' + sceneWord();
}

// ②場所の切り替え。③の3つは場所ごとに意味が違うので必ずリセットする
function setSrc(s) {
    if (s !== 'project' && s !== 'folder') return;
    if (filter.src === s) return;
    filter.src = s;
    resetTagFilters();
    syncSrcButtons();
    buildTagFilters();
    render();
    // ③が黙って戻ると「勝手に全件になった」と見えるため、切り替えのたびに理由を伝える
    showStatus('「' + (s === 'project' ? 'プロジェクト内' : 'PCフォルダ') +
        '」に切り替えました（③の絞り込みは「すべて」に戻ります）', '');
    // 保存は画面を描いたあと（失敗しても表示は切り替わり、そのことを最後に伝える）
    persistPrefs();
}

function syncSrcButtons() {
    var btns = document.querySelectorAll('#srcFilter .kf');
    for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('on', btns[i].getAttribute('data-s') === filter.src);
    }
}

// ── 描画 ──────────────────────────────────

// ②場所＋③（フリー/楽曲・場面・内訳）の範囲に入っているか。
// 判定に使うタグは③の項目を作るときと同じ itemTags なので、件数と中身は必ず一致する
function inScope(it) {
    if ((it.root === '__project__') !== (filter.src === 'project')) return false;
    var t = itemTags(it);
    if (filter.license && t.license !== filter.license) return false;
    if (filter.scene && t.scene !== filter.scene) return false;
    // 「（内訳なし）」は内訳が付いていない素材だけを通す（③の件数の作り方と表裏一体）
    if (filter.sub === SUB_NONE) { if (t.sub) return false; }
    else if (filter.sub && t.sub !== filter.sub) return false;
    return true;
}

// 検索用に正規化したタグ文字列の覚え書きを捨てる（タグを書き換えたときだけ呼ぶ）
function clearTagCache() {
    items.forEach(function (it) { it.tagsN = undefined; });
}

// タグはチップ表示しない（ユーザー要望2026-07-12：一覧はファイル名だけ）が、
// 検索の手がかりとしては生きている（検索欄にタグ語を打てばヒットする）
function visibleItems() {
    var q = nfc(filter.search).toLowerCase();
    return items.filter(function (it) {
        if (!kindPass(it)) return false;
        if (!inScope(it)) return false;
        if (!q) return true;
        if ((it.nameN || nfc(it.name).toLowerCase()).indexOf(q) >= 0) return true;
        // タグの正規化は素材1件につき1回だけ（打鍵のたびに全件やり直すと重い）
        if (it.tagsN === undefined) {
            var tags = settings.tags[it.pathN || nfc(it.path)] || [];
            it.tagsN = nfc(tags.join(' ')).toLowerCase();
        }
        return it.tagsN.indexOf(q) >= 0;
    });
}

// 中身は縦1列のリスト固定（ユーザー要望2026-08-02。横並びチップ表示は廃止）
function cardHtml(it, showUsage) {
    var idx = (it.i !== undefined) ? it.i : items.indexOf(it);
    var key = it.pathN || nfc(it.path);
    return '<div class="card row' + (checkedPaths[it.path] ? ' checked' : '') + '" data-i="' + idx + '" draggable="true">' +
        '<input type="checkbox" class="rcheck" data-i="' + idx + '"' + (checkedPaths[it.path] ? ' checked' : '') +
        ' title="チェックを付けるだけです（ここでは挿入されません）。一括挿入・書き出しの対象になります">' +
        '<span class="ricon">' + (audioKind(it) === 'bgm' ? '🎼' : '🎵') + '</span>' +
        '<span class="rname" title="' + escAttr(it.name) + '">' + esc(it.name.replace(/\.[^.]+$/, '')) + '</span>' +
        (showUsage ? '<span class="rusage">' + (settings.usage[key] || 0) + '回</span>' : '') +
        '<button class="tagbtn" data-i="' + idx +
        '" title="この素材のタグと種別（効果音/BGM）を決める">🏷</button>' +
        '</div>';
}

// 畳み状態を持つキー。③の束ね方（場面＋内訳）と同じにする＝見出しが③の項目と
// 1対1で対応する。②場所で同じ名前があっても畳み状態を共有しないよう頭を分ける
function groupKey(it) {
    var t = itemTags(it);
    return (it.root === '__project__' ? 'P:' : 'F:') + t.scene + (t.sub ? '/' + t.sub : '');
}

// 見出しに出す名前。場面と内訳だけ（登録フォルダ名やフルパスは出さない＝
// 同じ場面が登録フォルダごとに分かれて見えるのを防ぐため）
function groupLabel(it) {
    var t = itemTags(it);
    return t.scene + (t.sub ? '／' + t.sub : '');
}

// ③で狭く絞ったまま0件になったとき、③が原因だと気づけるようにする。
// 呼び名は②場所に合わせる（プロジェクト内はフォルダではなくビン）
function folderHint() {
    if (!filter.license && !filter.scene && !filter.sub) return '';
    // フリー/楽曲だけで絞って0件のときは、③はもう「すべて」が点いていて押しても何も変わらない。
    // 原因になっている段（画面の見出しは index.html の licStep ＝「フリー/楽曲」）のほうを指す
    if (filter.license && !filter.scene && !filter.sub) {
        return '<br>「フリー/楽曲」の「すべて」を押すと、フリーも楽曲も両方出ます';
    }
    // ③の場面・内訳はボタンではなくプルダウンなので「押す」ものが画面に無い。
    // 実際の操作（プルダウンを選び直す）と同じ言い方にする
    var where = sceneWord();
    return '<br>③の' + where + 'を「すべて」に選び直すと、ほかの' + where + 'も探せます';
}

// 0件のときの案内。①②③を畳んでいると、案内が指している段そのものが画面に出ていない
//（「①種類を…」と言われても①が無い）。畳んでいるときだけ開き方を1行足す
function emptyMessage() {
    var msg = emptyMessageBody();
    if (filtersCollapsed && /[①②③]|フリー\/楽曲/.test(msg)) {
        msg += '<br>（①②③は上の「絞り込み」の行を押すと開きます）';
    }
    return msg;
}

// 0件のときに「なぜ空なのか・次に何をすればいいか」を出す（原因ごとに文面を変える）
function emptyMessageBody() {
    if (filter.src === 'project') {
        // 走査の応答前・失敗時に「素材がありません」と言うと、原因と違う次の一手を示してしまう
        if (projectScan === 'loading') return 'プロジェクト内を確認中です...';
        if (projectScan === 'error') {
            return 'プロジェクト内を読み取れませんでした<br>' +
                'Premiereを再起動するか、②場所を「PCフォルダ」にしてください';
        }
        var hasProj = items.some(function (it) { return it.root === '__project__'; });
        if (!hasProj) {
            return 'このプロジェクトに音声素材がありません<br>' +
                'プロジェクトパネルに音を読み込むか、②場所を「PCフォルダ」にしてください';
        }
    } else if (settings.folders.length === 0) {
        // はじめて開いた人が読む唯一の道案内。⋯ の中に畳んだので「どこを開くか」から書く
        return '右上の' + moreItem('btnAddFolder') + 'で<br>PCの素材フォルダを登録してください';
    } else if (!items.some(function (it) { return it.root !== '__project__'; })) {
        // 登録フォルダ自体が見つからない（ドライブが外れた・移動/リネーム）ときに
        // 形式の話をしても解決しないので、原因のほうを先に出す
        if (missingRootsMsg) return esc(missingRootsMsg);
        // 登録はあるのに1件も拾えていない＝フォルダが空か、対応していない形式しか無い
        return '登録したフォルダに音声ファイルが見つかりません<br>' +
            '入れられるのは wav / mp3 / aif / aiff / m4a / ogg / flac です';
    }
    if (filter.search) return '「' + esc(filter.search) + '」に合う素材がありません' + folderHint();
    if (filter.kindSel) {
        return (filter.kindSel === 'bgm' ? 'BGM' : '効果音') +
            'はここにありません<br>①種類を「すべて」にすると全部出ます' + folderHint();
    }
    // 登録フォルダが複数あって一部だけ見つからないときは、残りの素材を拾えているので上の分岐に入らない。
    // ③で見つからない側の場面を選ぶと④だけが空になるため、ここでも原因を出す
    // （②プロジェクト内の空きはPCフォルダの不在と無関係なので除く。検索・①種類が原因のときは上で返っている）
    if (filter.src !== 'project' && missingRootsMsg) return esc(missingRootsMsg);
    return '該当する素材がありません' + folderHint();
}

// ★よく使うの上限と並び順（使用回数の多い順・同数ならファイル名の五十音順）
var FAV_MAX = 8;

function favCmp(a, b) {
    return (settings.usage[b.pathN || nfc(b.path)] || 0) - (settings.usage[a.pathN || nfc(a.path)] || 0) ||
        a.name.localeCompare(b.name, 'ja');
}

// いま④に出ている件数。☑モードを切り替えたときに見出しのヒントを出し分けるのに使う
var visCount = 0;

// ④見出しのヒント。押した結果（挿入／チェック）が変わるので文言も合わせる。
// 0件のときは押すものが無いので何も出さない
function syncGridHint() {
    var el = document.querySelector('#gridHead .ghint');
    if (!el) return;
    el.textContent = (visCount === 0) ? '' : (checkMode ? 'クリックでチェック' : 'クリックで挿入');
}

function render() {
    kindMemo = {};
    var grid = document.getElementById('grid');
    var vis = visibleItems();
    visCount = vis.length;
    document.getElementById('gridCount').textContent = vis.length + '件';
    syncGridHint();
    // 絞り込みを畳んでいるときの1行サマリーも、一覧と同じタイミングで作り直す
    // （render は絞り込みが変わるたびに必ず通るので、ここに置けば表示とズレない）
    updateFilterSummary();
    if (vis.length === 0) {
        grid.innerHTML = '<div class="empty">' + emptyMessage() + '</div>';
        return;
    }
    settings.collapsed = settings.collapsed || {};
    var groups = {};
    var labels = {};
    var order = [];
    vis.forEach(function (it) {
        var g = groupKey(it);
        if (!groups[g]) { groups[g] = []; order.push(g); labels[g] = groupLabel(it); }
        groups[g].push(it);
    });
    order.sort(function (a, b) { return a.localeCompare(b, 'ja'); });
    var html = '';
    // ★よく使う：使用回数のある素材の上位を最上段に固定表示（下の通常グループにも重複して出る）
    var favSeen = {};
    var fav = [];
    vis.forEach(function (it) {
        var key = it.pathN || nfc(it.path);
        if (favSeen[key]) return;
        favSeen[key] = true;
        if (!((settings.usage[key] || 0) > 0)) return;
        // 全件を並べ替えず上位8件だけ持ち歩く（数千件でも並べ替えの負荷が増えない）。
        // 同じ順位のものは先に見つけた方を前に置く＝全件ソートしたときと同じ並びになる
        if (fav.length >= FAV_MAX && favCmp(it, fav[FAV_MAX - 1]) >= 0) return;
        var pos = fav.length;
        while (pos > 0 && favCmp(it, fav[pos - 1]) < 0) pos--;
        fav.splice(pos, 0, it);
        if (fav.length > FAV_MAX) fav.pop();
    });
    if (fav.length > 0) {
        var fg = '★ よく使う';
        var fcol = settings.collapsed[fg] === true;
        html += '<div class="ghead fav" data-g="' + escAttr(fg) + '"' +
            ' title="よく使う素材の上位8件（下の一覧にも同じ素材が表示されます）">' +
            '<span class="garrow">' + (fcol ? '▸' : '▾') + '</span>' +
            '<span class="gname">' + esc(fg) + '</span>' +
            '<span class="gcount">' + fav.length + '</span></div>';
        if (!fcol) html += fav.map(function (it) { return cardHtml(it, true); }).join('');
    }
    order.forEach(function (g) {
        var col = settings.collapsed[g] === true;
        html += '<div class="ghead" data-g="' + escAttr(g) + '" title="' + escAttr(labels[g]) + '">' +
            '<span class="garrow">' + (col ? '▸' : '▾') + '</span>' +
            '<span class="gname">' + esc(labels[g]) + '</span>' +
            '<span class="gcount">' + groups[g].length + '</span></div>';
        if (!col) html += groups[g].map(function (it) { return cardHtml(it, false); }).join('');
    });
    grid.innerHTML = html;
}

// ── 挿入 ──────────────────────────────────

// 挿入成功時に使用回数を記録（★よく使うの並び順に使う）。
// 連続挿入中に並びが入れ替わるとクリック先がずれるため、挿入では一切再描画せず
// 表示中の回数バッジだけ更新する。★の出現・並び替えは次の自然な再描画
// （フィルタ変更・再スキャン・グループ開閉等）のタイミングで反映する
function bumpUsage(paths) {
    paths.forEach(function (p) {
        var k = nfc(p);
        settings.usage[k] = (settings.usage[k] || 0) + 1;
    });
    saveSettings();
    var cards = document.querySelectorAll('#grid .card');
    for (var i = 0; i < cards.length; i++) {
        var it = items[+cards[i].getAttribute('data-i')];
        if (!it) continue;
        var badge = cards[i].querySelector('.rusage');
        if (badge) badge.textContent = (settings.usage[it.pathN || nfc(it.path)] || 0) + '回';
    }
}

// 挿入結果メッセージ（例「A1 に 2件配置しました」）から成功件数を取り出す
function insertedCount(result) {
    var m = String(result).match(/(\d+)件配置/);
    return m ? parseInt(m[1], 10) : 0;
}

// 挿入先トラックは種別ごと（既定：効果音=A3・BGM=A4）
var trackPrefs = { se: '3', bgm: '4' };

function trackFor(it) {
    return trackPrefs[audioKind(it) === 'bgm' ? 'bgm' : 'se'];
}

function insertItem(it) {
    var a = trackFor(it);
    var ow = document.getElementById('modeOverwrite').checked;
    showStatus(it.name + ' を配置中...', '');
    // import用の原文パス(NFD)と、JSX側でのビン照合用にNFC正規化したパスの両方を渡す
    var script = 'sdInsertAudioAtHeads(' + JSON.stringify(it.path) +
        ',' + JSON.stringify(it.pathN || nfc(it.path)) +
        ',' + JSON.stringify(a) + ',' + JSON.stringify(String(ow)) + ')';
    cs.evalScript(script, function (result) {
        if (!result || result === 'undefined') { showStatus('エラー: レスポンスなし', 'error'); return; }
        // OK: 以外はすべて失敗扱い（JSX未ロード時の "EvalScript error." を成功表示しない）
        if (result.indexOf('OK:') !== 0) {
            showStatus(result.indexOf('ERR:') === 0 ? result.slice(4) : result, 'error');
            return;
        }
        // 使用回数の保存（bumpUsage）を先に済ませてから表示する。
        // 逆順だと、保存できない環境で挿入のたびに成功表示が赤字で塗り潰され、
        // 配置そのものが失敗したように見えてしまう
        if (insertedCount(result) > 0) bumpUsage([it.path]);
        showStatusWithSaveWarning(it.name + ' → ' + result.slice(3));
    });
}

// ── オートプレビュー ────────────────────────

function startPreview(it) {
    if (!document.getElementById('hoverPlay').checked) return;
    if (it.kind !== 'audio') return;
    hoverTimer = setTimeout(function () {
        previewAudio.src = fileUrl(it.path);
        previewAudio.volume = document.getElementById('volume').value / 100;
        previewAudio.play().catch(function () {});
    }, 200);
}

function stopPreview() {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    previewAudio.pause();
}

// ── SE書き出し（人に送る用） ─────────────────

function exportChecked() {
    var paths = Object.keys(checkedPaths);
    if (paths.length === 0) { showStatus('送りたい効果音・BGMにチェックを入れてください', 'error'); return; }
    var res = window.cep.fs.showSaveDialogEx('効果音・BGMをzipに書き出し', '', ['zip'], '効果音・BGM素材.zip');
    if (res.err !== 0 || !res.data) return;
    // 書き出すと決めた時点で ⋯ の用は済み。結果（成功・失敗）は下段に出るので隠さない
    hidePopup('moreMenu');
    var dest = res.data;
    if (!/\.zip$/i.test(dest)) dest += '.zip';
    showStatus('zip作成中...', '');
    cp.execFile('zip', ['-j', dest].concat(paths), { maxBuffer: 50 * 1024 * 1024 }, function (err) {
        if (err) { showStatus('書き出し失敗: ' + err.message, 'error'); return; }
        showStatus(paths.length + '件の効果音・BGMを書き出しました: ' + dest.split('/').pop(), 'success');
        cp.execFile('open', ['-R', dest], function () {});
    });
}

// ── タグ編集 ───────────────────────────────

function openTagModal(it) {
    tagEditPath = it.pathN || nfc(it.path);
    document.getElementById('tagModalName').textContent = it.name;
    var inp = document.getElementById('tagInput');
    inp.placeholder = 'タグをカンマ区切りで入力';
    inp.value = (settings.tags[tagEditPath] || []).join(', ');
    pendingKind = settings.kindOverride[tagEditPath] || '';
    syncKindButtons(pendingKind);
    document.getElementById('tagModal').classList.remove('hidden');
    inp.focus();
}

// タグ編集画面の種別ボタン（自動/効果音/BGM）。タグと同じく「保存」で確定・「キャンセル」で破棄。
// 「自動」は手動指定を消して自動判定に戻す
var pendingKind = '';

function syncKindButtons(sel) {
    var btns = document.querySelectorAll('#kindRow .km');
    for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('on', btns[i].getAttribute('data-k') === sel);
    }
}

function saveTags() {
    var raw = document.getElementById('tagInput').value;
    var tags = raw.split(/[,、]/).map(function (t) { return t.trim(); }).filter(Boolean);
    if (tags.length) settings.tags[tagEditPath] = tags;
    else delete settings.tags[tagEditPath];
    if (pendingKind) settings.kindOverride[tagEditPath] = pendingKind;
    else delete settings.kindOverride[tagEditPath];
    clearTagCache();
    closeTagModal();
    // 種別を手で変えると①種類の内訳が変わるので、③の項目と件数も作り直す
    buildTagFilters(filter.src === 'project' && projectScan !== 'ok');
    render();
    // 保存は画面を直したあと（保存に失敗しても編集画面は閉じ、一覧には反映する）
    saveSettings();
    // 手動指定を「自動」に戻した素材が長さ未計測の場合に備えて計測を回す（計測済みは対象外）
    probeDurations();
}

function closeTagModal() {
    document.getElementById('tagModal').classList.add('hidden');
    tagEditPath = null;
}

// ── ユーティリティ ─────────────────────────

function fileUrl(p) {
    return 'file://' + p.split('/').map(encodeURIComponent).join('/');
}

function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;');
}

function showStatus(msg, type) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = type || '';
}

// ── イベント ───────────────────────────────

document.getElementById('btnAddFolder').addEventListener('click', addFolder);
document.getElementById('btnRemoveFolder').addEventListener('click', removeFolder);
document.getElementById('btnAutoTag').addEventListener('click', autoTagAll);
document.getElementById('btnRescan').addEventListener('click', function () { rescan('', true); });
document.getElementById('btnSend').addEventListener('click', exportChecked);

// 数千件あると1打鍵ごとの全再描画が重いので、打ち終わりまで少し待ってから描く
var SEARCH_DEBOUNCE_MS = 120;
var searchTimer = null;

document.getElementById('search').addEventListener('input', function () {
    var v = this.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
        filter.search = v;
        render();
    }, SEARCH_DEBOUNCE_MS);
});

// ③の3段（フリー/楽曲・場面・内訳）。選び直すと下の段の顔ぶれと件数が変わるので必ず作り直す。
// 下の段の選択は消さない＝まだ使えるなら残す（使えなくなった段だけ buildTagFilters が戻す）。
// 中身は buildTagFilters が毎回まるごと作り直すので、目印はどちらも入れ物（行）側に付ける

// 3-a（フリー/楽曲）はボタン列のまま。[すべて][フリー][楽曲] の3個だけで押しやすいため
function bindTagRow(rowId, key) {
    document.getElementById(rowId).addEventListener('click', function (e) {
        var v = e.target.getAttribute('data-v');
        if (v === null) return;
        filter[key] = v;
        buildTagFilters();
        // 先に一覧を描く（保存に失敗しても選んだ中身は必ず表示する）
        render();
        persistPrefs();
    });
}

// 3-b（場面）・3-c（内訳）はプルダウン。changeは選び直したときだけ上がってくる
function bindTagSelect(rowId, key) {
    document.getElementById(rowId).addEventListener('change', function (e) {
        var sel = e.target;
        if (!sel || sel.tagName !== 'SELECT') return;
        filter[key] = sel.value;
        buildTagFilters();
        // 先に一覧を描く（保存に失敗しても選んだ中身は必ず表示する）
        render();
        persistPrefs();
    });
}

bindTagRow('licFilter', 'license');
bindTagSelect('sceneFilter', 'scene');
bindTagSelect('subFilter', 'sub');

// ②場所：プロジェクト内 / PCフォルダ
document.getElementById('srcFilter').addEventListener('click', function (e) {
    var s = e.target.getAttribute('data-s');
    if (s) setSrc(s);
});

// ①種類：すべて/効果音/BGM（③の項目と件数も種類で変わるので作り直す）
document.getElementById('kindFilter').addEventListener('click', function (e) {
    var k = e.target.getAttribute('data-k');
    if (k === null) return;
    filter.kindSel = k;
    var btns = this.querySelectorAll('.kf');
    for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('on', btns[i].getAttribute('data-k') === k);
    }
    // プロジェクト走査の応答前はビンの素材がまだ無い。preserveしないと③の選択が消え、
    // 直後のpersistPrefsで空のまま保存されて走査が終わっても戻らなくなる
    buildTagFilters(filter.src === 'project' && projectScan !== 'ok');
    render();
    persistPrefs();
});

// タグ編集画面の種別ボタン：選ぶだけ（確定は「保存」・「キャンセル」で破棄）
document.getElementById('kindRow').addEventListener('click', function (e) {
    var k = e.target.getAttribute('data-k');
    if (k === null || !tagEditPath) return;
    pendingKind = k;
    syncKindButtons(k);
});

var grid = document.getElementById('grid');

// ★よく使うと通常グループに同じ素材が重複表示されるため、チェック状態は全カードで同期する
function syncChecks() {
    var rows = grid.querySelectorAll('.card.row');
    for (var i = 0; i < rows.length; i++) {
        var it = items[+rows[i].getAttribute('data-i')];
        if (!it) continue;
        var on = !!checkedPaths[it.path];
        rows[i].classList.toggle('checked', on);
        var box = rows[i].querySelector('.rcheck');
        if (box) box.checked = on;
    }
}

function updateBulkBtn() {
    var n = Object.keys(checkedPaths).length;
    var btn = document.getElementById('btnBulk');
    btn.textContent = n > 0 ? '一括挿入 (' + n + ')' : '一括挿入';
    btn.disabled = n === 0;
    document.getElementById('btnClearChecks').disabled = n === 0;
    // 書き出しは ⋯ の中に畳んだので、チェックを付けた人には見つからない。
    // チェックがある間だけ ⋯ に印を出して「この中に続きがある」と知らせる
    var more = document.getElementById('btnMore');
    if (!more) return;
    more.classList.toggle('mark', n > 0);
    more.title = MORE_TITLE + (n > 0
        ? '　※チェック中の' + n + '件は、この中の「' + btnName('btnSend') + '」で書き出せます'
        : '');
}

function bulkInsert() {
    var paths = Object.keys(checkedPaths);
    if (paths.length === 0) return;
    // 全部BGMならBGM用トラック、1つでも効果音が混ざればSE用トラックへ
    var kindByPath = {};
    items.forEach(function (it) { kindByPath[it.path] = audioKind(it); });
    var allBgm = true;
    for (var pi = 0; pi < paths.length; pi++) {
        if (kindByPath[paths[pi]] !== 'bgm') { allBgm = false; break; }
    }
    var a = allBgm ? trackPrefs.bgm : trackPrefs.se;
    var ow = document.getElementById('modeOverwrite').checked;
    showStatus('一括配置中...', '');
    var btn = document.getElementById('btnBulk');
    btn.disabled = true;
    // import用パス(NFD)とNFC照合用パスを同じ順で渡す
    var pathsN = paths.map(function (p) { return nfc(p); });
    cs.evalScript('sdBulkInsertAudio(' + JSON.stringify(paths.join('\n')) +
        ',' + JSON.stringify(pathsN.join('\n')) +
        ',' + JSON.stringify(a) + ',' + JSON.stringify(String(ow)) + ')', function (result) {
        btn.disabled = false;
        if (!result || result === 'undefined') { showStatus('エラー: レスポンスなし', 'error'); return; }
        // OK: 以外はすべて失敗扱い（JSX未ロード時の "EvalScript error." を成功表示しない）
        if (result.indexOf('OK:') !== 0) {
            showStatus(result.indexOf('ERR:') === 0 ? result.slice(4) : result, 'error');
            return;
        }
        // insertItemと同じ順（保存 → 表示）。挿入は成功したのに赤字だけが残るのを防ぐ
        if (insertedCount(result) > 0) bumpUsage(paths);
        showStatusWithSaveWarning(result.slice(3));
    });
}

document.getElementById('btnBulk').addEventListener('click', bulkInsert);

document.getElementById('btnCheckMode').addEventListener('click', function () {
    checkMode = !checkMode;
    this.classList.toggle('on', checkMode);
    // ④見出しの案内が「クリックで挿入」のままだと説明と動作が食い違う
    syncGridHint();
});

document.getElementById('btnClearChecks').addEventListener('click', function () {
    checkedPaths = {};
    updateBulkBtn();
    render();
    showStatus('チェックをすべて外しました', 'success');
});

grid.addEventListener('click', function (e) {
    if (e.target.classList.contains('rcheck')) {
        var cit = items[+e.target.getAttribute('data-i')];
        if (!cit) return;
        if (e.target.checked) {
            checkedPaths[cit.path] = 1;
            // ☑モードOFFのときは押しても何も起きないように見える（＝壊れたと誤解される）ので、
            // 入れたときだけ「挿入ではない」と伝える。外したときは黙る
            showStatus('チェックしました（挿入はされていません）', '');
        } else {
            delete checkedPaths[cit.path];
        }
        syncChecks();
        updateBulkBtn();
        return;
    }
    var gh = e.target.closest('.ghead');
    if (gh) {
        var g = gh.getAttribute('data-g');
        settings.collapsed = settings.collapsed || {};
        settings.collapsed[g] = !settings.collapsed[g];
        // 開閉を画面に反映してから保存する（保存に失敗しても開閉自体は効かせる）
        render();
        saveSettings();
        return;
    }
    var tagBtn = e.target.closest('.tagbtn');
    if (tagBtn) {
        var tit = items[+tagBtn.getAttribute('data-i')];
        if (tit) openTagModal(tit);
        return;
    }
    var card = e.target.closest('.card');
    if (!card) return;
    // 再描画とクリックが行き違うと data-i が古くなることがあるため必ず存在確認する
    var it = items[+card.getAttribute('data-i')];
    if (!it) return;
    if (checkMode && it.kind === 'audio') {
        if (checkedPaths[it.path]) delete checkedPaths[it.path];
        else checkedPaths[it.path] = 1;
        syncChecks();
        updateBulkBtn();
        return;
    }
    insertItem(it);
});
// CEPのD&D: com.adobe.cep.dnd.file.N にパスを積むとPremiereのタイムラインへドロップできる
grid.addEventListener('dragstart', function (e) {
    var card = e.target.closest('.card');
    if (!card) return;
    var it = items[+card.getAttribute('data-i')];
    if (!it) return;
    var paths;
    if (it.kind === 'audio' && checkedPaths[it.path] && Object.keys(checkedPaths).length > 1) {
        paths = Object.keys(checkedPaths);
    } else {
        paths = [it.path];
    }
    for (var i = 0; i < paths.length; i++) {
        e.dataTransfer.setData('com.adobe.cep.dnd.file.' + i, paths[i]);
    }
    e.dataTransfer.effectAllowed = 'copy';
    stopPreview();
});

grid.addEventListener('mouseover', function (e) {
    var card = e.target.closest('.card');
    if (!card || card.contains(e.relatedTarget)) return;
    var hit = items[+card.getAttribute('data-i')];
    if (hit) startPreview(hit);
});
grid.addEventListener('mouseout', function (e) {
    var card = e.target.closest('.card');
    if (!card || card.contains(e.relatedTarget)) return;
    stopPreview();
});

document.getElementById('tagSave').addEventListener('click', saveTags);
document.getElementById('tagCancel').addEventListener('click', closeTagModal);
document.getElementById('tagInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') saveTags();
    if (e.key === 'Escape') closeTagModal();
});

function trackLabel(v) {
    return (v === 'auto') ? 'AUTO' : 'A' + v;
}

function syncTrackBtns() {
    document.getElementById('seTrackBtn').textContent = trackLabel(trackPrefs.se);
    document.getElementById('bgmTrackBtn').textContent = trackLabel(trackPrefs.bgm);
    syncSettingsBtn();
}

// ⚙設定の中へ隠した「挿入先」と「上書き」は、事故ると気づきにくい設定
//（とくに上書きは既定ONで、知らずに既にある音を消してしまう）。
// 隠しても見張りが残るよう、いまの値をボタンの文字に出しておく。
// 細いパネルでは文字数が増えると下の列が2行に折り返すので、そのときは「⚙ 設定」に戻す
function syncSettingsBtn() {
    var btn = document.getElementById('btnSettings');
    if (!btn) return;
    var ov = document.getElementById('modeOverwrite');
    var vals = trackLabel(trackPrefs.se) + '/' + trackLabel(trackPrefs.bgm) + ((ov && ov.checked) ? '・上書き' : '');
    btn.textContent = (window.innerWidth >= SETTINGS_LABEL_MIN_W) ? ('⚙ ' + vals) : '⚙ 設定';
    btn.title = '挿入先トラック・上書き・ホバー再生・音量の設定（いまは ' + vals + '）';
}

// ⋯ のホバー説明の土台。チェックがあるときは書き出しの案内をこの後ろに足す。
// 文言は index.html から読む＝直書きせず、あちらを直せばこちらも付いてくる（btnName と同じ考え方）
var MORE_TITLE = (function () {
    var b = document.getElementById('btnMore');
    return b ? String(b.getAttribute('title') || '') : '';
})();

// 挿入先の選択メニューを閉じる。⚙設定が閉じるところでは必ずこれも呼ぶ
//（⚙設定の上に浮いているメニューなので、土台だけ消えて選択肢が宙に取り残される）
function hideTrackMenu() {
    var m = document.getElementById('aTrackMenu');
    if (m) m.classList.add('hidden');
}

// 挿入先メニューを開く場所を決める。開いている間は幅・高さが変わるたびに呼び直す
function placeTrackMenu() {
    var menu = document.getElementById('aTrackMenu');
    if (!menu || menu.classList.contains('hidden')) return;
    var footH = document.getElementById('footer').offsetHeight;
    var setM = document.getElementById('setMenu');
    var setH = (setM && !setM.classList.contains('hidden')) ? setM.offsetHeight + 4 : 0;
    var vh = window.innerHeight;
    // ふだんは⚙設定のさらに上へ重ねる（⚙設定の裏に隠れると選べない）。
    // ただしパネルが低いと上に開く余地が無くなるので、余地が足りないときは
    // ⚙設定にかぶせてでも高さを確保する（あとから描くこちらが手前に出る）
    var bottom = footH + setH + 4;
    if (vh - bottom - 8 < TRACK_MENU_MIN_H) bottom = footH + 4;
    if (vh - bottom - 8 < TRACK_MENU_MIN_H) bottom = 4;
    menu.style.bottom = bottom + 'px';
    // 高さを画面に収める。これが無いと上端がマイナス座標へ出て、上のほうの
    // 選択肢が押せなくなる（パネル最小高300pxでは約7割が画面外だった）。
    // あふれるぶんはスクロールで届く。ふだんの高さではCSSと同じ280pxで頭打ちにして見た目を変えない
    menu.style.maxHeight = Math.max(60, Math.min(280, vh - bottom - 8)) + 'px';
}

(function () {
    // パネル下端のネイティブselectはリストが開けないため、上方向に開く自作メニューで選択する。
    // メニューはSE用/BGM用ボタンで共有し、押したボタン側の設定を書き換える
    var menu = document.getElementById('aTrackMenu');
    var menuTarget = 'se';
    var html = '<div class="tmhead" id="aTrackMenuTitle"></div>';
    html += '<div class="tmi" data-v="auto">AUTO（空き自動）</div>';
    for (var i = 1; i <= 16; i++) html += '<div class="tmi" data-v="' + i + '">A' + i + '</div>';
    menu.innerHTML = html;

    function openFor(target, e) {
        e.stopPropagation();
        if (!menu.classList.contains('hidden') && menuTarget === target) {
            menu.classList.add('hidden');
            return;
        }
        menuTarget = target;
        // どちらの設定を変えているかをヘッダーで示し、現在値をハイライトする
        document.getElementById('aTrackMenuTitle').textContent =
            (target === 'se') ? 'SE（効果音）の挿入先' : 'BGMの挿入先';
        var tmis = menu.querySelectorAll('.tmi');
        for (var t = 0; t < tmis.length; t++) {
            tmis[t].classList.toggle('on', tmis[t].getAttribute('data-v') === trackPrefs[target]);
        }
        // 場所の計算は placeTrackMenu にまとめてある（開いたあとの画面サイズ変更でも同じ計算を使う）
        menu.classList.remove('hidden');
        placeTrackMenu();
    }

    document.getElementById('seTrackBtn').addEventListener('click', function (e) { openFor('se', e); });
    document.getElementById('bgmTrackBtn').addEventListener('click', function (e) { openFor('bgm', e); });
    menu.addEventListener('click', function (e) {
        // ここで止めないと、下の「外側を押したら閉じる」まで伝わって⚙設定ごと閉じてしまう。
        // SEを選んだ直後にBGMも決める、という続けざまの操作ができなくなる
        e.stopPropagation();
        var v = e.target.getAttribute('data-v');
        if (!v) return;
        trackPrefs[menuTarget] = v;
        syncTrackBtns();
        persistPrefs();
        menu.classList.add('hidden');
    });
    document.addEventListener('click', function () { menu.classList.add('hidden'); });
    // 開いたまま幅・高さが変わると場所がずれる（低いパネルでは画面外へ出る）ので置き直す
    window.addEventListener('resize', placeTrackMenu);
})();

// ── 縦を節約するための3つの入れ物（⋯ ／ ⚙設定 ／ ①②③を畳む）───────────
// どれも「④の一覧に使える縦を増やす」ためのもの。浮かせて出す（position:fixed）ので、
// 開いても一覧は縮まない。閉じているあいだの高さは0。

// 上のボタン列の ⋯ と、フッターの ⚙設定。どちらも
// 「ボタンを押すと開く／もう一度押すと閉じる／外側を押すと閉じる／中を押しても閉じない」。
// 中を押しても閉じないのは、−フォルダ・🏷自動の2回押し確定の赤と、
// 設定を続けて2つ3つ変える操作を途中で切らないため
// 浮かせて出す入れ物の一覧。閉じる処理を1か所にまとめる＝閉じ忘れの経路を作らない
var POPUP_IDS = ['moreMenu', 'setMenu'];

// どの経路から閉じるときも必ずここを通す。⚙設定を閉じるときは、その上に浮いている
// 挿入先メニューも道連れにする（これが無いと⚙設定だけ消えて選択肢が宙に残る）
function hidePopup(id) {
    var m = document.getElementById(id);
    if (m) m.classList.add('hidden');
    if (id === 'setMenu') hideTrackMenu();
    // ⋯ が閉じると「2回押して確定」の赤い合図（.arm）が見えなくなる。見えない待ちは生かしておかない。
    // 生かしたままだと、閉じてから4秒以内に開き直して同じボタンを押した人が、
    // 確認も赤も無いまま解除・一括タグ付けを確定させてしまう（タグと使用回数が消える）
    if (id === 'moreMenu') {
        if (removeArmedRoot) disarmRemove(true);
        if (autoTagArmed) disarmAutoTag(true);
    }
}

// 開くときは、もう一方を閉じる（⋯ と ⚙設定 が同時に出ると画面の上下が両方ふさがる）
function hideOtherPopups(exceptId) {
    POPUP_IDS.forEach(function (id) { if (id !== exceptId) hidePopup(id); });
}

function bindPopup(btnId, menuId, place) {
    var btn = document.getElementById(btnId);
    var menu = document.getElementById(menuId);
    if (!btn || !menu) return;
    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (menu.classList.contains('hidden')) {
            hideOtherPopups(menuId);
            place(btn, menu);
            menu.classList.remove('hidden');
        } else hidePopup(menuId);
    });
    menu.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { hidePopup(menuId); });
    // パネルの幅・高さが変わると開いたままの場所がずれるので、開いている時だけ置き直す
    window.addEventListener('resize', function () {
        if (!menu.classList.contains('hidden')) place(btn, menu);
    });
}

bindPopup('btnMore', 'moreMenu', function (btn, menu) {
    // ⋯ のすぐ下、右端はパネルの右端に合わせる（右端に出す＝押したボタンの真下に見える）
    var r = btn.getBoundingClientRect();
    menu.style.top = Math.round(r.bottom + 2) + 'px';
    menu.style.right = '8px';
    menu.style.left = 'auto';
});

bindPopup('btnSettings', 'setMenu', function (btn, menu) {
    // フッターのすぐ上に、パネルの左右いっぱいで出す（挿入先・音量は横幅があるほど扱いやすい）
    menu.style.bottom = (document.getElementById('footer').offsetHeight + 4) + 'px';
    menu.style.left = '8px';
    menu.style.right = '8px';
});

// ⚙設定の中の「挿入先ボタン以外」を押したら、挿入先メニューは用済みなので閉じる。
// 挿入先ボタン自身は openFor が伝播を止めるので、ここへは来ない（＝押しても閉じない）
document.getElementById('setMenu').addEventListener('click', hideTrackMenu);

// ①②③の絞り込みを畳む／開く。畳むと #filterRow（最大5行）が消えて1行のサマリーだけ残る
function applyFilterCollapsed() {
    document.body.classList.toggle('filters-collapsed', filtersCollapsed);
    document.getElementById('filterSummary').classList.toggle('hidden', !filtersCollapsed);
    var btn = document.getElementById('btnFilterToggle');
    // 記号だけだと「④を畳むボタン」と読まれる（④の見出しの中にあり、色も④の色なので）。
    // 幅が足りるときは「絞り込み」の文字を添えて、何が畳まれるのかを言い切る
    btn.textContent = (window.innerWidth >= FILTER_LABEL_MIN_W ? '絞り込み ' : '') + (filtersCollapsed ? '▼' : '▲');
    btn.title = filtersCollapsed
        ? '①②③の絞り込みをまた開く'
        : '①②③の絞り込みを畳んで、一覧を広く使う';
    updateFilterSummary();
}

// 幅が変わったら、記号だけに落とす／文字を戻すを両方のボタンで見直す
window.addEventListener('resize', function () {
    applyFilterCollapsed();
    syncSettingsBtn();
});

// 畳んだときの1行サマリー。値は画面に出ている文字をそのまま拾う＝
// 表示と食い違わない（別に文言を持つと、片方を直したときにもう片方が古いまま残る）
function updateFilterSummary() {
    var el = document.getElementById('fsumText');
    if (!el) return;
    // 「エモい系 (39)」の末尾の件数は畳んだ1行では邪魔なので落とす（全角・半角どちらの括弧も）
    function strip(s) { return String(s || '').replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim(); }
    // ボタン（3-a）の件数は括弧を付けずに「すべて 39」と素で書いてある（tagBtn）。
    // 括弧しか落とさないと「すべて 39」が残り、絞っていないのに絞り込み中に見える。
    // 数字落としはボタンにだけ効かせる（プルダウンの項目名は括弧付きなので上のstripで足りる。
    // ここまで数字を落とすと「BGM 2」のような名前の場面まで削ってしまう）
    function stripBtn(s) { return strip(s).replace(/\s+\d+$/, '').trim(); }
    function pick(rowId) {
        var row = document.getElementById(rowId);
        if (!row) return '';
        var sel = row.querySelector('select');
        if (sel) return strip(sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : '');
        var on = row.querySelector('.kf.on');
        return on ? stripBtn(on.textContent) : '';
    }
    // 段が隠れている（フリー/楽曲・内訳が意味を持たない）ときは、その段の話をしない
    function shown(stepId) {
        var s = document.getElementById(stepId);
        return !!s && !s.classList.contains('hidden');
    }
    var parts = [];
    var k = pick('kindFilter');
    if (k && k !== 'すべて') parts.push(['s1', k]);
    var s = pick('srcFilter');
    if (s) parts.push(['s2', s]);
    if (shown('licStep')) { var l = pick('licFilter'); if (l && l !== 'すべて') parts.push(['s3', l]); }
    var sc = pick('sceneFilter');
    if (sc && sc !== 'すべて') parts.push(['s3', sc]);
    if (shown('subStep')) { var sb = pick('subFilter'); if (sb && sb !== 'すべて') parts.push(['s3', sb]); }
    if (parts.length === 0) { el.textContent = 'すべて'; return; }
    var html = '';
    parts.forEach(function (p, i) {
        if (i > 0) html += '<span class="sep"> ／ </span>';
        html += '<span class="' + p[0] + '">' + esc(p[1]) + '</span>';
    });
    el.innerHTML = html;
}

document.getElementById('btnFilterToggle').addEventListener('click', function () {
    filtersCollapsed = !filtersCollapsed;
    applyFilterCollapsed();
    persistPrefs();
});
// サマリーの行そのものを押しても開く（▼だけを狙わせない＝押す的を大きくする）
document.getElementById('filterSummary').addEventListener('click', function () {
    filtersCollapsed = false;
    applyFilterCollapsed();
    persistPrefs();
});

['modeOverwrite', 'hoverPlay'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', persistPrefs);
});
// 上書きは⚙の中に隠れたぶん、ボタンの文字（「⚙ A3/A4・上書き」）が唯一の見張りになる
document.getElementById('modeOverwrite').addEventListener('change', syncSettingsBtn);
document.getElementById('volume').addEventListener('input', function () {
    previewAudio.volume = this.value / 100;
    persistPrefs();
});

function validTrack(v) {
    return v === 'auto' || (/^\d{1,2}$/.test(String(v)) && +v >= 1 && +v <= 16);
}

function persistPrefs() {
    settings.prefs = {
        seTrack: trackPrefs.se,
        bgmTrack: trackPrefs.bgm,
        overwrite: document.getElementById('modeOverwrite').checked,
        hoverPlay: document.getElementById('hoverPlay').checked,
        volume: +document.getElementById('volume').value,
        kindSel: filter.kindSel,
        src: filter.src,
        license: filter.license,
        scene: filter.scene,
        sub: filter.sub,
        filtersCollapsed: filtersCollapsed
    };
    saveSettings();
}

function restorePrefs() {
    var p = settings.prefs;
    if (validTrack(p.seTrack)) trackPrefs.se = String(p.seTrack);
    else if (validTrack(p.aTrack)) trackPrefs.se = String(p.aTrack); // 旧・単一設定の引き継ぎ
    if (validTrack(p.bgmTrack)) trackPrefs.bgm = String(p.bgmTrack);
    syncTrackBtns();
    if (p.overwrite !== undefined) document.getElementById('modeOverwrite').checked = p.overwrite;
    if (p.hoverPlay !== undefined) document.getElementById('hoverPlay').checked = p.hoverPlay;
    if (p.volume !== undefined) document.getElementById('volume').value = p.volume;
    if (p.kindSel === 'se' || p.kindSel === 'bgm') {
        filter.kindSel = p.kindSel;
        var btns = document.querySelectorAll('#kindFilter .kf');
        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.toggle('on', btns[i].getAttribute('data-k') === p.kindSel);
        }
    }
    if (p.src === 'project' || p.src === 'folder') filter.src = p.src;
    syncSrcButtons();
    // 前回の③の絞り込み。いま無いタグなら buildTagFilters が「すべて」に戻す。
    // 旧版の設定（フォルダのパスだけを持つ p.folder）は意味が変わったので読まない
    // ＝そのまま「すべて」で開く（読み込みで落ちないことのほうが大事）
    if (p.license === 'free' || p.license === 'paid') filter.license = p.license;
    if (typeof p.scene === 'string') filter.scene = p.scene;
    if (typeof p.sub === 'string') filter.sub = p.sub;
    // 畳んだ状態は覚えておく。設定が壊れていて true/false 以外が入っていたら「開いた状態」で出す
    // （畳まれた状態で出て①②③が見当たらないほうが、初見のユーザーには困る）
    filtersCollapsed = (p.filtersCollapsed === true);
    applyFilterCollapsed();
    // 上書きの復元はこの関数の中ほどなので、⚙の文字（現在値つき）は最後にもう一度そろえる
    syncSettingsBtn();
}

// ── 起動 ──────────────────────────────────

loadSettings();
restorePrefs();
rescan();
