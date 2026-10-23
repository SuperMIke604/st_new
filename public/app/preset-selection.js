// A dedicated per-user server file is the only authority after migration.
export class PresetSelection {
    constructor(api) { this.api = api; this.name = null; this.queue = Promise.resolve(); }
    async load(settings, names) {
        await this.queue.catch(() => {});
        const saved = await this.api.loadPresetSelection();
        if (saved) { this.name = saved.name; return this.name; }
        const legacy = [settings.extension_settings?.independent_frontend?.preset, settings.independent_frontend?.preset].find(value => typeof value === 'string' && names.includes(value));
        const initial = legacy || names[0];
        if (initial) await this.save(initial);
        return this.name;
    }
    save(name) {
        if (typeof name !== 'string' || !name.trim()) return Promise.reject(Error('预设名称无效'));
        const task = this.queue.catch(() => {}).then(async () => {
            await this.api.savePresetSelection({ version: 1, name });
            this.name = name;
        });
        this.queue = task; return task;
    }
}
