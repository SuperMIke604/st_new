// Native light-dismiss may close an auto popover between pointerdown and
// click. Remember the initial state so a second tap closes instead of reopening.
export function installPopoverToggle(button, popup, { open, close, pointerTarget = button, isOpen = () => popup.matches(':popover-open') }) {
    let pointerWasOpen = false;
    button.setAttribute('popovertarget', popup.id);
    pointerTarget.addEventListener('pointerdown', () => { pointerWasOpen = isOpen(); });
    pointerTarget.addEventListener('pointercancel', () => { pointerWasOpen = false; });
    const activate = event => {
        event.preventDefault();
        const shouldClose = isOpen() || (event.detail > 0 && pointerWasOpen);
        pointerWasOpen = false;
        if (shouldClose) close(); else open();
    };
    button.addEventListener('click', activate);
    return activate;
}
