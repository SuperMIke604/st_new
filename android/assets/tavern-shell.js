(() => {
    window.addEventListener('message', function connect(event) {
        if (event.data !== 'st-new-android-shell' || !event.ports[0]) return;
        window.removeEventListener('message', connect);
        const port = event.ports[0];
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
