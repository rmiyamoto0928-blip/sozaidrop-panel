/**
 * CSInterface - Minimal implementation for CEP panel ↔ host communication
 */
function CSInterface() {}

CSInterface.prototype.evalScript = function (script, callback) {
    var cb = callback || function () {};
    if (typeof __adobe_cep__ !== 'undefined') {
        __adobe_cep__.evalScript(script, cb);
    } else if (window.__adobe_cep__) {
        window.__adobe_cep__.evalScript(script, cb);
    } else {
        console.warn('[SyncSelector] Adobe CEP runtime not found');
        cb(JSON.stringify({ error: 'CEP runtime が見つかりません' }));
    }
};
