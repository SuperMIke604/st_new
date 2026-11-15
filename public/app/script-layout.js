// Serialized into the sandbox. A zero-size Shadow DOM host can still contain
// fixed-position interactive widgets; measure the visible controls, not the host.
export function scriptLayoutNodes(document, computedStyle) {
    const nodes = [], shadows = [], rects = []; let visited = 0;
    function paintedRect(rect, style) {
        let left = 0, top = 0, right = 0, bottom = 0;
        // A blur paints beyond the border box. Keep the extra iframe hit area
        // bounded even when a script uses a very large shadow or offset.
        const maxOutset = 128;
        for (const shadow of (style.boxShadow || '').split(/,(?![^()]*\))/)) {
            if (/\binset\b|\btransparent\b|rgba\([^)]*,\s*0\s*\)|\/\s*0(?:%|\.0+)?\s*\)/i.test(shadow)) continue;
            const lengths = shadow.replace(/\([^()]*\)/g, '').match(/-?(?:\d+\.?\d*|\.\d+)px\b/g);
            if (!lengths || lengths.length < 2) continue;
            const [x, y, blur = 0, spread = 0] = lengths.map(value => Number.parseFloat(value));
            if (![x, y, blur, spread].every(Number.isFinite)) continue;
            const radius = blur * 1.5 + spread;
            left = Math.max(left, radius - x);
            top = Math.max(top, radius - y);
            right = Math.max(right, radius + x);
            bottom = Math.max(bottom, radius + y);
        }
        const x = Math.floor(rect.x - Math.min(left, maxOutset));
        const y = Math.floor(rect.y - Math.min(top, maxOutset));
        const endX = Math.ceil(rect.x + rect.width + Math.min(right, maxOutset));
        const endY = Math.ceil(rect.y + rect.height + Math.min(bottom, maxOutset));
        return [x, y, endX - x, endY - y];
    }
    const visit = (node, depth = 0) => {
        if (++visited > 3000 || depth > 24 || nodes.length >= 64 || ['SCRIPT', 'STYLE', 'LINK', 'HEAD'].includes(node.tagName)) return;
        const style = computedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
        const rect = node.getBoundingClientRect();
        if (node.shadowRoot) {
            shadows.push(node.shadowRoot);
            for (const child of node.shadowRoot.children) visit(child, depth + 1);
        } else if (rect.width > 0 && rect.height > 0 && style.pointerEvents !== 'none') {
            nodes.push(node);
            rects.push(paintedRect(rect, style));
        } else for (const child of node.children || []) visit(child, depth + 1);
    };
    for (const node of document.body.children) visit(node);
    for (const node of document.documentElement?.children || []) if (!['HEAD', 'BODY'].includes(node.tagName)) visit(node);
    return { nodes, shadows, rects };
}
