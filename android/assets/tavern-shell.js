(() => {
    function connectExports(port) {
        const chunkSize = 48 * 1024;
        let exporting = false;
        let reply;
        port.onmessage = ({ data }) => {
            if (data.startsWith('download:')) {
                const { url, name } = JSON.parse(data.slice('download:'.length));
                void exportFile(url, name);
            } else if (reply) {
                reply(data === 'export-ok');
            }
        };

        function send(message) {
            return new Promise(resolve => {
                reply = resolve;
                port.postMessage(message);
            });
        }

        function encode(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',', 2)[1]);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }

        async function exportFile(url, name) {
            if (exporting) {
                port.postMessage('export-busy');
                return;
            }
            exporting = true;
            try {
                // Start reading before the page revokes the Blob URL.
                const response = await fetch(url, { mode: 'same-origin', redirect: 'error' });
                if (!response.ok) throw new Error('Download failed');
                const blob = await response.blob();
                if (!await send('export-start:' + JSON.stringify({ name, type: blob.type, size: blob.size }))) return;
                for (let offset = 0; offset < blob.size; offset += chunkSize) {
                    const chunk = await encode(blob.slice(offset, offset + chunkSize));
                    if (!await send('export-chunk:' + chunk)) return;
                }
                await send('export-finish');
            } catch {
                port.postMessage('export-error');
            } finally {
                reply = null;
                exporting = false;
            }
        }

        const downloadSelector = 'a[download][href]';
        const anchor = HTMLAnchorElement.prototype;
        const click = anchor.click;
        function clickDownload() {
            // A detached anchor does not bubble its click through the document.
            if (!this.isConnected && this.matches(downloadSelector)) {
                void exportFile(this.href, this.download);
            } else {
                click.call(this);
            }
        }
        anchor.click = clickDownload;

        function onDownload(event) {
            if (event.defaultPrevented || !(event.target instanceof Element)) return;
            const link = event.target.closest(downloadSelector);
            if (!link) return;
            event.preventDefault();
            void exportFile(link.href, link.download);
        }
        document.addEventListener('click', onDownload, true);
        window.addEventListener('pagehide', () => {
            document.removeEventListener('click', onDownload, true);
            if (anchor.click === clickDownload) anchor.click = click;
        }, { once: true });
    }

    window.addEventListener('message', function connect(event) {
        if (!event.isTrusted || event.source !== null || event.data !== 'st-new-android-shell' || !event.ports[0]) return;
        window.removeEventListener('message', connect);
        const port = event.ports[0];
        connectExports(port);
        const theme = document.querySelector('meta[name="theme-color"]');
        function updateBars() {
            if (theme && /^#[0-9a-f]{6}$/i.test(theme.content)) port.postMessage(theme.content);
        }
        if (theme) {
            new MutationObserver(updateBars).observe(theme, { attributes: true, attributeFilter: ['content'] });
            updateBars();
        }

        const menu = document.getElementById('composer-tools');
        const toggle = document.getElementById('tools-toggle');
        if (menu && toggle && !document.getElementById('android-apk-update')) {
            const button = document.createElement('button');
            button.type = 'button';
            button.id = 'android-apk-update';
            button.className = 'button';
            button.textContent = '检查 APK 更新';
            button.addEventListener('click', () => {
                menu.hidden = true;
                toggle.setAttribute('aria-expanded', 'false');
                port.postMessage('check-apk-update');
            });
            const webUpdate = Array.from(menu.querySelectorAll('button'))
                .find(item => item.textContent.trim() === '检查更新');
            if (webUpdate) webUpdate.after(button);
            else menu.appendChild(button);
        }
    });
})();
