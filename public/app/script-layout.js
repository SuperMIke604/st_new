// Serialized into the sandbox. A zero-size Shadow DOM host can still contain
// fixed-position interactive widgets; measure the visible controls, not the host.
export function scriptLayoutNodes(document, computedStyle) {
    const nodes = [], shadows = []; let visited = 0;
    const visit = (node, depth = 0) => {
        if (++visited > 3000 || depth > 24 || nodes.length >= 64 || ['SCRIPT', 'STYLE', 'LINK', 'HEAD'].includes(node.tagName)) return;
        const style = computedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
        const rect = node.getBoundingClientRect();
        if (node.shadowRoot) {
            shadows.push(node.shadowRoot);
            for (const child of node.shadowRoot.children) visit(child, depth + 1);
        } else if (rect.width > 0 && rect.height > 0 && style.pointerEvents !== 'none') nodes.push(node);
        else for (const child of node.children || []) visit(child, depth + 1);
    };
    for (const node of document.body.children) visit(node);
    for (const node of document.documentElement?.children || []) if (!['HEAD', 'BODY'].includes(node.tagName)) visit(node);
    return { nodes, shadows };
}
