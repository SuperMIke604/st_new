// Unmodified reference defaults @ a9e295d32b2e691d9ae4399bf0b2b3c3fe922205
export const DEFAULT_CHAR_CARD_PROMPT = [
    {
        role: 'USER',
        content: ''
    },
    {
        role: 'assistant',
        content: ''
    }
];
export const DEFAULT_SETTINGS = {
    // 更新配置
    autoUpdateFrequency: 0,        // 最新N层不更新
    updateBatchSize: 1,            // 每次更新楼层数
    summaryTableMaxEntries: 10,    // 总结条目显示数量
    removeTags: '',                // 自定义删除标签
    userMessageTags: '',           // 用户消息标签

    // 核心操作
    autoUpdateEnabled: false,      // 启用自动更新
    autoHideMessages: true,        // 数据整理完成后自动隐藏相关楼层
    enableWorldbookGeneration: false, // 启用世界书生成（注入到提示词）

    // AI指令预设（支持多个预设，每个预设包含归属的可视化模板）
    charCardPrompts: [
        {
            name: '默认预设',
            prompt: DEFAULT_CHAR_CARD_PROMPT,
            overviewTemplate: ''  // 归属于此预设的可视化模板
        }
    ],
    currentPromptIndex: 0,  // 当前使用的预设索引

    // API配置
    apiMode: 'custom',             // API模式: 'custom' 或 'tavern'
    apiConfig: {
        url: '',                    // API基础URL
        apiKey: '',                 // API密钥
        model: '',                  // 模型名称
        useMainApi: true,           // 使用主API
        max_tokens: 120000,         // 最大Tokens
        temperature: 0.9            // 温度
    },
    tavernProfile: '',             // 酒馆连接预设ID

    // 世界书配置
    worldbookConfig: {
        source: 'character',        // 世界书来源: 'character' 或 'manual'
        injectionTarget: 'character', // 数据注入目标: 'character' 或世界书文件名
        manualSelection: [],        // 手动选择的世界书列表
        enabledEntries: {}          // 启用的世界书条目: {'worldbook_name': ['entry_uid1', 'entry_uid2']}
    },
    // 世界书排序（统一一个排序值，数值越小越靠前）
    worldbookOrder: 100,
    previewOnlyShowChanges: false,
};
