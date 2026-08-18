var TICKS_PER_SEC = 254016000000;

function sdGetBin() {
    var root = app.project.rootItem;
    var n = (root.children.numItems !== undefined) ? root.children.numItems : root.children.length;
    for (var i = 0; i < n; i++) {
        var child = root.children[i];
        if (child.type === ProjectItemType.BIN && child.name === 'SozaiDrop') return child;
    }
    return root.createBin('SozaiDrop');
}

// filePath=原文(macOSはNFD濁点分解)／filePathN=NFC正規化版。ES3にはString.normalizeが
// 無いためパネル側で両方を作って渡す。getMediaPath()がどちらの形で返しても照合できるよう
// 両方と比較する（濁点入り＝ガ/ド/バ等の日本語SEで一致が外れて再import増殖するのを防ぐ）
function sdSearchBin(bin, filePath, filePathN) {
    var n = (bin.children.numItems !== undefined) ? bin.children.numItems : bin.children.length;
    for (var i = 0; i < n; i++) {
        var child = bin.children[i];
        if (child.type === ProjectItemType.CLIP) {
            try {
                var mp = child.getMediaPath();
                if (mp === filePath || (filePathN && mp === filePathN)) return child;
            } catch (e) {}
        } else if (child.type === ProjectItemType.BIN || child.type === ProjectItemType.ROOT) {
            var found = sdSearchBin(child, filePath, filePathN);
            if (found) return found;
        }
    }
    return null;
}

// import直後に増えた末尾のクリップを返す（getMediaPathの正規化形がNFC/NFDどちらとも
// 一致しなかった取りこぼしを救うフォールバック）。beforeCount=import前の子要素数
function sdNewestClipInBin(bin, beforeCount) {
    var after = (bin.children.numItems !== undefined) ? bin.children.numItems : bin.children.length;
    var i;
    for (i = after - 1; i >= beforeCount; i--) {
        var c = bin.children[i];
        if (c && c.type === ProjectItemType.CLIP) return c;
    }
    for (i = after - 1; i >= 0; i--) {
        var c2 = bin.children[i];
        if (c2 && c2.type === ProjectItemType.CLIP) return c2;
    }
    return null;
}

// filePathN は任意（旧経路=sdInsert からは未指定で呼ばれる）
function sdImportItem(filePath, filePathN) {
    var item = sdSearchBin(app.project.rootItem, filePath, filePathN);
    if (item) return item;
    var bin = sdGetBin();
    var before = (bin.children.numItems !== undefined) ? bin.children.numItems : bin.children.length;
    app.project.importFiles([filePath], true, bin, false);
    item = sdSearchBin(app.project.rootItem, filePath, filePathN);
    if (item) return item;
    // 事前検索も再検索も外れた場合の取りこぼし対策：import直後の新規クリップを返す
    return sdNewestClipInBin(bin, before);
}

function sdTrackFree(track, t, dur) {
    try { if (track.isLocked && track.isLocked()) return false; } catch (e) {}
    var n = (track.clips.numItems !== undefined) ? track.clips.numItems : track.clips.length;
    for (var i = 0; i < n; i++) {
        var c = track.clips[i];
        var s = c.start.seconds, e = c.end.seconds;
        if (s < t + dur && t < e) return false;
    }
    return true;
}

// spec: 'auto' なら空きトラック番号、数字文字列なら手動指定（1始まり→0始まりに変換）
function sdResolveTrack(tracks, spec, t, dur) {
    var numTracks = (tracks.numTracks !== undefined) ? tracks.numTracks : tracks.length;
    if (spec === 'auto') {
        for (var i = 0; i < numTracks; i++) {
            if (sdTrackFree(tracks[i], t, dur)) return i;
        }
        return -1;
    }
    var idx = parseInt(spec, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= numTracks) return -2;
    return idx;
}

function sdItemDuration(item) {
    try {
        var inP = item.getInPoint().seconds;
        var outP = item.getOutPoint().seconds;
        if (outP > inP) return outP - inP;
    } catch (e) {}
    return 1;
}

// レコード区切り=CharCode1、フィールド区切り=CharCode2（ExtendScriptはJSON非対応）
// 開いている全プロジェクトを走査する（trailの先頭がプロジェクト名）
function sdListProjectAudio() {
    try {
        var out = [];
        var n = (app.projects.numProjects !== undefined) ? app.projects.numProjects : app.projects.length;
        for (var i = 0; i < n; i++) {
            var proj = app.projects[i];
            var pname = String(proj.name).replace(/\.prproj$/i, '');
            sdCollectAudio(proj.rootItem, pname, out, pname);
        }
        return out.length > 0 ? out.join(String.fromCharCode(1)) : 'EMPTY';
    } catch (e) {
        return 'ERR:' + e.toString();
    }
}

function sdCollectAudio(bin, trail, out, rootTrail) {
    var audioExts = ['.wav', '.mp3', '.aif', '.aiff', '.m4a', '.ogg', '.flac'];
    var sep = String.fromCharCode(2);
    var n = (bin.children.numItems !== undefined) ? bin.children.numItems : bin.children.length;
    for (var i = 0; i < n; i++) {
        var child = bin.children[i];
        if (child.type === ProjectItemType.BIN) {
            // パネルが自動インポートした SozaiDrop ビンは一覧に出さない（フォルダ側と二重になるため）
            if (trail === rootTrail && child.name === 'SozaiDrop') continue;
            sdCollectAudio(child, trail + '/' + child.name, out, rootTrail);
        } else if (child.type === ProjectItemType.CLIP) {
            try {
                var p = child.getMediaPath();
                var ext = p.toLowerCase().substring(p.lastIndexOf('.'));
                for (var ei = 0; ei < audioExts.length; ei++) {
                    if (ext === audioExts[ei]) {
                        out.push(trail + sep + child.name + sep + p);
                        break;
                    }
                }
            } catch (e) {}
        }
    }
}

// activeSequence を再代入するとタイムラインパネルにフォーカスが移る
function sdFocusTimeline(seq) {
    try { app.project.activeSequence = seq; } catch (e) {}
}

function sdRestoreSelection(seq, selIds) {
    function pass(tracks) {
        var numTracks = (tracks.numTracks !== undefined) ? tracks.numTracks : tracks.length;
        for (var ti = 0; ti < numTracks; ti++) {
            var clips = tracks[ti].clips;
            var n = (clips.numItems !== undefined) ? clips.numItems : clips.length;
            for (var ci = 0; ci < n; ci++) {
                var c = clips[ci];
                try { c.setSelected(selIds[c.nodeId] === true, true); } catch (e) {}
            }
        }
    }
    pass(seq.videoTracks);
    pass(seq.audioTracks);
}

// getSelection() は他シーケンスのクリップも返すため activeSequence の nodeId でフィルタ
function sdSelectionStarts(seq) {
    var seqIds = {};
    function collect(tracks) {
        var nt = (tracks.numTracks !== undefined) ? tracks.numTracks : tracks.length;
        for (var ti = 0; ti < nt; ti++) {
            var clips = tracks[ti].clips;
            var nc = (clips.numItems !== undefined) ? clips.numItems : clips.length;
            for (var ci = 0; ci < nc; ci++) {
                try { seqIds[clips[ci].nodeId] = true; } catch (e) {}
            }
        }
    }
    collect(seq.videoTracks);
    collect(seq.audioTracks);

    var selIds = {};
    var hasSel = false;
    var starts = [];
    var sel = seq.getSelection();
    var selLen = sel ? ((sel.numItems !== undefined) ? sel.numItems : sel.length) : 0;
    for (var i = 0; i < selLen; i++) {
        try {
            var si = sel[i];
            if (seqIds[si.nodeId] !== true) continue;
            selIds[si.nodeId] = true;
            hasSel = true;
            var s = si.start.seconds;
            var dup = false;
            for (var j = 0; j < starts.length; j++) {
                if (Math.abs(starts[j] - s) < 0.001) { dup = true; break; }
            }
            if (!dup && !isNaN(s)) starts.push(s);
        } catch (e) {}
    }
    if (starts.length === 0) starts.push(seq.getPlayerPosition().seconds);
    starts.sort(function (a, b) { return a - b; });
    return { starts: starts, selIds: selIds, hasSel: hasSel };
}

function sdResolveAudioTrackForStarts(seq, aSpec, starts, dur) {
    var tracks = seq.audioTracks;
    var numTracks = (tracks.numTracks !== undefined) ? tracks.numTracks : tracks.length;
    if (aSpec === 'auto') {
        for (var ti = 0; ti < numTracks; ti++) {
            var free = true;
            for (var k = 0; k < starts.length; k++) {
                if (!sdTrackFree(tracks[ti], starts[k], dur)) { free = false; break; }
            }
            if (free) return ti;
        }
        return -1;
    }
    var idx = parseInt(aSpec, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= numTracks) return -2;
    return idx;
}

function sdInsertAudioAtHeads(filePath, filePathN, aSpec, overwrite) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return 'ERR:アクティブなシーケンスがありません';

        var selInfo = sdSelectionStarts(seq);
        var starts = selInfo.starts;
        var selIds = selInfo.selIds;
        var hasSel = selInfo.hasSel;

        var item = sdImportItem(filePath, filePathN);
        if (!item) return 'ERR:ファイルの読み込みに失敗しました';
        var dur = sdItemDuration(item);

        var tracks = seq.audioTracks;
        var idx = sdResolveAudioTrackForStarts(seq, aSpec, starts, dur);
        if (idx === -1) return 'ERR:全挿入位置が空いているオーディオトラックがありません';
        if (idx === -2) return 'ERR:トラック番号が不正です';

        var isOw = (overwrite === 'true' || overwrite === true);
        var ok = 0, ng = 0;
        var p;
        if (isOw) {
            // 上書きは後続クリップを動かさないので昇順のままでよい。
            // 失敗時に黙ってinsertへ切り替えると後続が右ずれ＆音ズレするので、失敗として数える
            for (p = 0; p < starts.length; p++) {
                try { tracks[idx].overwriteClip(item, starts[p]); ok++; }
                catch (e1) { ng++; }
            }
        } else {
            // 非上書きは insertClip が後続を右シフトするため、後ろの挿入位置から処理して
            // 前の位置計算が狂わないようにする（20クリップ一括で2個目以降が全ズレする不具合の対策）
            for (p = starts.length - 1; p >= 0; p--) {
                try { tracks[idx].insertClip(item, starts[p]); ok++; }
                catch (e2) { ng++; }
            }
        }

        if (hasSel) sdRestoreSelection(seq, selIds);
        sdFocusTimeline(seq);

        var msg = 'OK:A' + (idx + 1) + ' に ' + ok + '件配置しました';
        if (ng > 0) msg += '（失敗 ' + ng + '件）';
        return msg;
    } catch (e) {
        return 'ERR:' + e.toString();
    }
}

// 一括挿入：選択クリップ各頭に、複数SEからランダム（直前と同じSEは回避）で配置
// filesStr=import用パス(原文NFD)、filesNStr=NFC照合用パスを同じ順で\n連結して渡す
function sdBulkInsertAudio(filesStr, filesNStr, aSpec, overwrite) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return 'ERR:アクティブなシーケンスがありません';

        var files = filesStr.split('\n');
        var filesN = (filesNStr ? filesNStr.split('\n') : []);
        var selInfo = sdSelectionStarts(seq);
        var starts = selInfo.starts;

        var fItems = [];
        var maxDur = 1;
        for (var fi = 0; fi < files.length; fi++) {
            var it = sdImportItem(files[fi], filesN[fi]);
            if (!it) continue;
            var d = sdItemDuration(it);
            if (d > maxDur) maxDur = d;
            fItems.push({ path: files[fi], item: it, dur: d });
        }
        if (fItems.length === 0) return 'ERR:ファイルの読み込みに失敗しました';

        var tracks = seq.audioTracks;
        var idx = sdResolveAudioTrackForStarts(seq, aSpec, starts, maxDur);
        if (idx === -1) return 'ERR:全挿入位置が空いているオーディオトラックがありません';
        if (idx === -2) return 'ERR:トラック番号が不正です';

        var isOw = (overwrite === 'true' || overwrite === true);
        // 非上書きは後続を右シフトするため後ろの位置から処理する。上書きは昇順のまま
        var order = [];
        var oi;
        if (isOw) { for (oi = 0; oi < starts.length; oi++) order.push(oi); }
        else { for (oi = starts.length - 1; oi >= 0; oi--) order.push(oi); }

        var ok = 0, ng = 0;
        var last = null;
        for (var pp = 0; pp < order.length; pp++) {
            var sidx = order[pp];
            var pick;
            if (fItems.length === 1) {
                pick = fItems[0];
            } else {
                var pool = [];
                for (var pi = 0; pi < fItems.length; pi++) {
                    if (fItems[pi] !== last) pool.push(fItems[pi]);
                }
                pick = pool[Math.floor(Math.random() * pool.length)];
            }
            last = pick;
            if (isOw) {
                // 失敗を黙ってinsertへ切り替えない（後続が右ずれ＆音ズレするため失敗として数える）
                try { tracks[idx].overwriteClip(pick.item, starts[sidx]); ok++; }
                catch (e1) { ng++; }
            } else {
                try { tracks[idx].insertClip(pick.item, starts[sidx]); ok++; }
                catch (e2) { ng++; }
            }
        }

        if (selInfo.hasSel) sdRestoreSelection(seq, selInfo.selIds);
        sdFocusTimeline(seq);

        var msg = 'OK:A' + (idx + 1) + ' に ' + ok + '件配置しました';
        if (ng > 0) msg += '（失敗 ' + ng + '件）';
        return msg;
    } catch (e) {
        return 'ERR:' + e.toString();
    }
}

function sdInsert(filePath, kind, vSpec, aSpec, overwrite) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return 'ERR:アクティブなシーケンスがありません';
        var t = seq.getPlayerPosition().seconds;

        if (kind === 'mogrt') {
            var vIdx = sdResolveTrack(seq.videoTracks, vSpec, t, 1);
            if (vIdx === -1) return 'ERR:空きビデオトラックがありません';
            if (vIdx === -2) return 'ERR:ビデオトラック番号が不正です';
            var aIdx = sdResolveTrack(seq.audioTracks, aSpec, t, 1);
            if (aIdx < 0) aIdx = 0;
            var ticks = seq.getPlayerPosition().ticks;
            var mgt = seq.importMGT(filePath, ticks, vIdx, aIdx);
            if (!mgt) return 'ERR:MOGRTの配置に失敗しました';
            sdFocusTimeline(seq);
            return 'OK:V' + (vIdx + 1) + ' に配置しました';
        }

        var item = sdImportItem(filePath);
        if (!item) return 'ERR:ファイルの読み込みに失敗しました';
        var dur = sdItemDuration(item);

        var tracks, label;
        if (kind === 'audio') {
            tracks = seq.audioTracks; label = 'A';
        } else {
            tracks = seq.videoTracks; label = 'V';
        }
        var idx = sdResolveTrack(tracks, (kind === 'audio') ? aSpec : vSpec, t, dur);
        if (idx === -1) return 'ERR:空きトラックがありません（再生ヘッド位置＋素材の長さ分）';
        if (idx === -2) return 'ERR:トラック番号が不正です';

        try {
            if (overwrite === 'true' || overwrite === true) {
                tracks[idx].overwriteClip(item, t);
            } else {
                tracks[idx].insertClip(item, t);
            }
        } catch (e1) {
            try { tracks[idx].insertClip(item, t); }
            catch (e2) { return 'ERR:' + e2.toString(); }
        }
        sdFocusTimeline(seq);
        return 'OK:' + label + (idx + 1) + ' に配置しました';
    } catch (e) {
        return 'ERR:' + e.toString();
    }
}
