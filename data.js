/* ============================================================
   data.js  —  收藏夹数据
   只需编辑此文件即可增删改收藏内容，无需修改页面代码

   卡片 type：
     'simple'         — 整卡点击打开 url
     'desc-clickable' — 卡片打开 url，描述文字打开 descUrl
     'expandable'     — 带展开子菜单（subCards）
                        描述可用 desc（纯文本）或 descClickable + descUrl（可点击链接）

   子卡片：
     两行式  { icon, title, desc, url }
     紧凑式  { icon, content, url }
     图片图标用 iconImg 代替 icon；本地跳转加 isLocal: true

   图标 icon 的三种写法：
     1. Emoji / 文字
        icon: '🔥'
        icon: 'AI'

     2. 图片链接（使用 iconImg 字段代替 icon）
        iconImg: 'https://example.com/logo.png'

     3. 内联 SVG（使用 icon 字段，值为 SVG 字符串，SVG 字符串必须写在同一行）
        单行写法（普通引号）：
          icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">...</svg>'

   SVG 图标注意事项：
     - SVG 必须写成单行字符串，多行写法可能导致 JS 解析失败
     - 必须包含 xmlns="http://www.w3.org/2000/svg" 和 viewBox
     - 避免使用 <linearGradient> 等带 id 的元素，若使用请确保 id 全局唯一
     - CSS 中 .link-icon-svg svg 需设为 width/height: 100% 以匹配图片图标大小
     - 建议 viewBox 统一用 "0 0 128 128"，保持图标风格一致

   Section 字段：
     builtin: true=内置不可删 / false=自定义可删
     key:     唯一标识（内置项锁死，对应旧变量名）
     kind:    'card' | 'email' | 'contact'
     dynamic: 是否启用卡片展开/折叠
     visible: 用户可关闭显示
     label:   用户可改名 | defaultLabel: 用于恢复默认
   ============================================================ */

/* ============================================================
   ⚠️ 以下 __META__ 区块由 scripts/update-timestamp.js 自动维护
      请勿手动编辑，手动改也会被下一次脚本运行覆盖
   ============================================================ */

/* __META_START__ */
window.APP_DATA_META = {
    version:   '2026-08-05-006',
    updatedAt: '2026-08-05T06:26:12.473Z',
    source:    'kv'
};
/* __META_END__ */

var sections = [
    // ==================== ☁️ 在线U盘 ====================
    {
        builtin: true,
        key: 'usbDriveData',
        kind: 'card',
        dynamic: false,
        label: '☁️ 在线U盘',
        visible: true,
        cards: [
            {
                icon: '👩🏻‍🏫',
                id: 'lty-xinhua',
                title: 'lty在线U盘(新华)',
                url: 'https://www.jianguoyun.com/p/DTPAg6sQptHYCBjA6_YFIAA',
                type: 'desc-clickable',
                descClickable: 'to2.top/lty',
                descUrl: 'http://mrr.cc/lty'
            },
            {
                id: 'lty-longan',
                icon: '👩🏻‍⚖️',
                title: 'lty在线U盘(隆安)',
                url: 'https://www.jianguoyun.com/p/DQ0EyaEQptHYCBj9ivkFIAA',
                type: 'desc-clickable',
                descClickable: 'to2.top/la',
                descUrl: 'http://mrr.cc/la'
            },
            {
                icon: '💾',
                id: 'zz',
                title: 'zz在线U盘',
                url: 'https://www.jianguoyun.com/p/DRNDENoQyu2zDBjYlZ0GIAA',
                type: 'expandable',
                descClickable: 'to2.top/u',
                descUrl: 'http://to2.top/u',
                subCards: [
                    {
                        icon: '📤',
                        title: '临时上传分享',
                        desc: 'f66.fun/fun mrr.cc/cc(密码：zz1001)',
                        url: 'https://www.jianguoyun.com/p/DemLEOwQpYHpBRiwtscFIAA'
                    },
                    {
                        icon: '📥',
                        title: '临时加密上传',
                        desc: 'n29.net/net (密码：临时ZZ67)',
                        url: 'https://www.jianguoyun.com/p/Das4Xf8QpYHpBRj68J8GIAA'
                    },
                    {
                        icon: '📁',
                        title: '在线U备用',
                        desc: 'mrr.cc/u或n29.net/u',
                        url: 'https://www.jianguoyun.com/p/DRNDENoQyu2zDBjYlZ0GIAA'
                    }
                ]
            },
            {
                id: 'oplist',
                iconImg: 'https://o.n29.net/p/00%E5%AE%B6%E5%BA%AD%E4%BA%91%E7%A1%AC%E7%9B%9800/%E5%AD%98%E5%82%A8/A1/Share/pubphoto/catcloud.png?sign=vwyhzmBGhTCy_XAWy9wsDkPnuzk0JIZ3ddGOcQFGCPU=:0',
                title: 'Oplist云硬盘',
                url: 'https://o.n29.net/',
                type: 'expandable',
                descClickable: 'n29.net',
                descUrl: 'https://n29.net/',
                subCards: [
                    {
                        iconImg: 'https://o.n29.net/p/00%E5%AE%B6%E5%BA%AD%E4%BA%91%E7%A1%AC%E7%9B%9800/%E5%AD%98%E5%82%A8/A1/Share/pubphoto/1f408_1.png?sign=lrzrBwcoutlJ87ypmRrNxvKTcZHUKoWiOqb1432x4to=:0',
                        title: '云硬盘',
                        desc: 'w.n29.net',
                        url: 'https://992929.xyz/'
                    },
                    {
                        icon: '💽',
                        title: '备用地址',
                        desc: 'n29.net/29',
                        url: 'http://92999.top:2999/'
                    },
                    {
                        icon: '🌳',
                        title: '永硕E盘',
                        desc: 'cccpan.com',
                        url: 'http://yumumao.ysepan.com/'
                    },
                    {
                        icon: '🖼',
                        title: '图床',
                        desc: 's.ee',
                        url: 'https://s.ee/'
                    }
                ]
            }
        ]
    },
    // ==================== 📚 授课资料 ====================
    {
        builtin: true,
        key: 'teachingData',
        kind: 'card',
        dynamic: false,
        label: '📚 授课资料',
        visible: true,
        cards: [
            {
                id: 'chaoxing',
                icon: '👨‍⚕',
                title: '超星平台',
                url: 'https://gdpu.fanya.chaoxing.com/',
                type: 'expandable',
                descClickable: '广药@超星',
                descUrl: 'https://gdpu.fanya.chaoxing.com/',
                subCards: [
                    {
                        icon: '🩺',
                        title: '超星-生理学1',
                        desc: 'f66.fun/mooc1',
                        url: 'https://mooc1.chaoxing.com/mooc-ans/course/214155769.html'
                    },
                    {
                        icon: '🧫',
                        title: '超星-生理学2',
                        desc: 'f66.fun/mooc',
                        url: 'https://mooc1-2.chaoxing.com/mooc-ans/course/214155769.html'
                    },
                    {
                        icon: '🏛️',
                        title: '融合门户',
                        desc: 'portal.gdpu.edu.cn/#/index',
                        url: 'https://portal.gdpu.edu.cn/#/index'
                    },
                    {
                        icon: '🌐',
                        title: '校园网登录',
                        desc: '172.21.199.252',
                        url: 'http://172.21.199.252/'
                    }
                ]
            },
            {
                id: 'ppt',
                icon: '👨🏻‍🏫',
                title: '生理学PPT',
                url: 'https://www.jianguoyun.com/p/DczPqnIQyu2zDBi3oYMGIAA',
                type: 'expandable',
                descClickable: 'f66.fun/slx',
                descUrl: 'http://f66.fun/slx',
                subCards: [
                    {
                        icon: '👨🏻‍🔬',
                        title: '广药实验视频',
                        desc: 'f66.fun/ve',
                        url: 'https://www.jianguoyun.com/p/DRHT5LcQzLmCCRj5x6kF'
                    },
                    {
                        icon: '🐰',
                        title: '其他实验视频',
                        desc: '其他操作视频',
                        url: 'https://www.jianguoyun.com/p/DYsBRugQzLmCCRjd74AG'
                    },
                    {
                        icon: '🩺',
                        title: '生理知识大纲',
                        desc: '关联临床知识',
                        url: 'tools/slxzsd.html?from=index',
                        isLocal: true
                    },
                    {
                        icon: '🚑',
                        title: '急救知识',
                        desc: 'f66.fun/aid',
                        url: 'https://www.jianguoyun.com/p/DdCoU9cQzLmCCRia2bgFIAA'
                    }
                ]
            },
            {
                id: 'medical-tools',
                icon: '🏥',
                title: '在线医学工具',
                url: 'https://www.medsci.cn/medsci-tools',
                type: 'expandable',
                desc: '算/表/统',
                subCards: [
                    {
                        icon: '💉',
                        title: '梅斯医学计算器',
                        desc: 'm.medsci.cn/scale/index.do',
                        url: 'https://m.medsci.cn/scale/index.do'
                    },
                    {
                        icon: '💊',
                        title: '用药助手',
                        desc: 'drugs.dxy.cn',
                        url: 'https://drugs.dxy.cn/'
                    },
                    {
                        icon: '📐',
                        title: '医脉通医学计算',
                        desc: 'cals.medlive.cn',
                        url: 'https://cals.medlive.cn/'
                    },
                    {
                        icon: '🌏',
                        title: 'Mstata医学统计',
                        desc: 'mstata.com/',
                        url: 'https://www.mstata.com/'
                    }
                ]
            },
            {
                id: 'calc-tools',
                icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect x="20" y="10" width="88" height="108" rx="16" fill="#5C6BC0"/><rect x="20" y="10" width="88" height="46" rx="16" fill="#fff" opacity="0.1"/><rect x="32" y="22" width="64" height="30" rx="6" fill="#B2DFDB"/><text x="64" y="45" text-anchor="middle" font-family="Arial" font-weight="900" font-size="22" fill="#004D40">AI</text><path d="M88 25l2 5h5l-4 3 2 5-5-3-5 3 2-5-4-3h5z" fill="#FFD600"/><circle cx="44" cy="72" r="7" fill="#FFAB91"/><circle cx="64" cy="72" r="7" fill="#FFAB91"/><circle cx="84" cy="72" r="7" fill="#FFE082"/><circle cx="44" cy="96" r="7" fill="#E8EAF6"/><circle cx="64" cy="96" r="7" fill="#E8EAF6"/><circle cx="84" cy="96" r="7" fill="#66BB6A"/></svg>',
                title: '在线计算器',
                url: 'https://www.geogebra.org/',
                type: 'expandable',
                desc: '在线算',
                subCards: [
                    {
                        icon: '📈',
                        title: 'Desmos图形计算器',
                        desc: 'desmos.com/calculator',
                        url: 'https://www.desmos.com/calculator?lang=zh-CN'
                    },
                    {
                        icon: '⌨️',
                        title: 'wolframalpha计算智能',
                        desc: 'wolframalpha.com',
                        url: 'https://wolframalpha.com'
                    },
                    {
                        icon: '🔢',
                        title: 'GeoGebra计算套件',
                        desc: 'geogebra.org/calculator',
                        url: 'https://www.geogebra.org/calculator'
                    }
                ]
            },
            {
                icon: '👨🏻‍🔧',
                id: 'ohthercalc-tools',
                title: '在线工具',
                url: '/toolsindex.html',
                type: 'expandable',
                desc: '在线小工具',
                subCards: [
                    {
                        icon: '🧪',
                        title: 'SIMPOP',
                        desc: '中学实验模拟',
                        url: 'https://simpop.org/'
                    },
                    {
                        icon: '🧲',
                        title: 'myphysics',
                        desc: '物理教学资料库',
                        url: 'https://myphysics-lab.com/'
                    },
                    {
                        icon: '🛠️',
                        title: '一个木函',
                        desc: '小工具集',
                        url: 'https://ol.woobx.cn/'
                    },
                    {
                        icon: '🔄',
                        title: '转换文件格式',
                        desc: '全格式转换',
                        url: 'https://www.aconvert.com/cn/'
                    }
                ]
            },
            {
                icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F2FBFE"/><stop offset=".5" stop-color="#EAF8FC"/><stop offset=".5" stop-color="#D8EFF8"/><stop offset="1" stop-color="#CFEAF5"/></linearGradient><linearGradient id="laser" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1E88C8" stop-opacity=".15"/><stop offset=".5" stop-color="#6BE7FF"/><stop offset="1" stop-color="#1E88C8" stop-opacity=".15"/></linearGradient></defs><g fill="none" stroke="#1E88C8" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"><path d="M44 176V104c0-33 27-60 60-60h78"/><path d="M330 44h78c33 0 60 27 60 60v78"/><path d="M468 330v78c0 33-27 60-60 60h-78"/><path d="M182 468h-78c-33 0-60-27-60-60v-78"/></g><rect x="132" y="112" width="248" height="288" rx="44" fill="url(#bg)"/><rect x="132" y="112" width="248" height="288" rx="44" fill="none" stroke="#1E88C8" stroke-width="20"/><rect x="72" y="241" width="368" height="30" rx="15" fill="#1E88C8"/><line x1="72" y1="249" x2="440" y2="249" stroke="url(#laser)" stroke-width="8" stroke-linecap="round"/><rect x="192" y="170" width="128" height="8" rx="4" fill="#1E88C8" opacity=".18"/><rect x="192" y="334" width="128" height="8" rx="4" fill="#1E88C8" opacity=".15"/></svg>',
                id: 'card_ms3cwpc1_2duf',
                title: 'ScanDex',
                url: 'https://scandex.n29.net',
                type: 'expandable',
                desc: '扫描图片管理',
                subCards: [
                    {
                        icon: '📇',
                        title: 'ImgToDoc',
                        desc: 'ImgToDoc服务（仅内网）',
                        url: 'http://192.168.2.166.:8787'
                    },
                    {
                        icon: '📓',
                        title: 'AI错题本',
                        desc: 'wn.n29.net',
                        url: 'https://wn.n29.net/'
                    }
                ]
            }
        ]
    },
    // ==================== 🖥️ 网络资源 ====================
    {
        builtin: true,
        key: 'onlineAIData',
        kind: 'card',
        dynamic: true,
        label: '🖥️ 网络资源',
        visible: true,
        cards: [
            {
                icon: '🧞',
                id: 'qwen',
                title: 'Qwen',
                url: 'https://chat.qwen.ai/',
                type: 'expandable',
                desc: '阿里千问等集合',
                subCards: [
                    {
                        icon: '🤿',
                        title: 'DeepSeek',
                        desc: '深度求索',
                        url: 'https://www.deepseek.com/'
                    },
                    {
                        icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#897EFF"/><stop offset="100%" stop-color="#5A42F2"/></linearGradient></defs><rect x="1" y="1" width="126" height="126" rx="28" fill="url(#g)" stroke="#FFF" stroke-width="1"/><g transform="translate(64 66) rotate(-22) scale(1.28)"><path fill="#FCFCFF" d="M-29-18L-40-37C-43-42-35-47-28-43L-12-33C-5-35 5-35 12-33L28-43C35-47 43-42 40-37L29-18C36-12 39-2 39 10C39 29 24 42 0 42C-24 42-39 29-39 10C-39-2-36-12-29-18Z"/><rect x="-16" y="-2" width="7" height="17" rx="3.5" fill="#6B58FF" transform="rotate(-12 -12 6)"/><rect x="9" y="-2" width="7" height="17" rx="3.5" fill="#6B58FF" transform="rotate(-12 13 6)"/></g></svg>',
                        title: 'WorkBuddy',
                        desc: '腾讯AI助手',
                        url: 'https://www.codebuddy.cn/home/'
                    },
                    {
                        icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect x="1" y="1" width="126" height="126" rx="28" fill="#000" stroke="#fff" stroke-width="1"/><text x="69.5" y="93" text-anchor="middle" font-family="Inter,\'SF Pro Display\',\'Helvetica Neue\',Helvetica,Arial,sans-serif" font-size="92" font-weight="500" transform="translate(-5.8 0) scale(0.92 1)" fill="#fff">K</text><circle cx="92" cy="34" r="4.2" fill="#2EA8FF"/></svg>',
                        title: 'kimi',
                        desc: 'Kimi AI',
                        url: 'https://www.kimi.com/',
                        comment: '[KIMI API 开放平台](https://platform.kimi.com/)'
                    },
                    {
                        icon: '💁‍',
                        title: '豆包',
                        desc: '字节跳动AI助手',
                        url: 'https://www.doubao.com/'
                    }
                ]
            },
            {
                id: 'poe',
                icon: '🧙‍',
                title: 'POE',
                desc: 'AI助手集合',
                url: 'https://poe.com/',
                type: 'expandable',
                subCards: [
                    {
                        icon: '✦',
                        title: 'Gemini',
                        desc: 'G家的AI',
                        url: 'https://gemini.google.com/'
                    },
                    {
                        icon: '💬',
                        title: 'ChatGPT',
                        desc: 'OpenAI聊天机器人',
                        url: 'https://chat.openai.com/'
                    },
                    {
                        icon: '🦊',
                        title: 'Grok',
                        desc: 'xAI的AI助手',
                        url: 'https://grok.com/'
                    },
                    {
                        icon: '🎆',
                        title: 'Claude',
                        desc: '擅长写代码',
                        url: 'https://www.anthropic.com/claude'
                    }
                ]
            },
            {
                id: 'mitasearch',
                icon: '🔎',
                title: '秘塔搜索',
                desc: 'AI实用工具',
                url: 'https://metaso.cn/',
                type: 'expandable',
                subCards: [
                    {
                        icon: '🔬',
                        title: '纳米搜索',
                        desc: 'AI搜索工具',
                        url: 'https://www.n.cn/'
                    },
                    {
                        icon: '✵',
                        title: 'Perplexity',
                        desc: 'AI搜索',
                        url: 'https://www.perplexity.ai/'
                    },
                    {
                        icon: '👁️‍🗨️',
                        title: 'BibiGPT',
                        desc: '音视频AI总结',
                        url: 'https://bibigpt.co/'
                    },
                    {
                        icon: '🐈',
                        title: '若愚',
                        desc: '文档翻译',
                        url: 'https://ruoyu.dingyu.me/'
                    }
                ]
            },
            {
                icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1368 1368"><path fill="#F6821F" d="M0 932c0-132 93-231 201-241-22-100 54-181 137-181 37 0 67 9 92 28 47-132 170-219 304-219 153 0 278 103 321 258-27 75-55 150-82 225-24 66-82 129-179 159H9c-5 0-9-4-9-9v-20z"/><path fill="#FDBA3D" d="M1077 589c149 0 291 109 291 267 0 29-5 56-13 81H969c-5 0-8-5-6-10l72-197c16-45 22-89 42-141z"/><path fill="#fff" d="M379 771h487c88 0 146-51 173-127l20-56c2-6 9-8 14-4 8 6 23 7 45 6-24 71-49 142-72 213-10 31 8 62 40 66l143 16c6 1 10 5 10 11s-5 10-11 10l-141 8c-39 2-73 26-88 63l-77 184c-3 7-14 5-12-3l54-236c8-35-19-69-55-69H379c-6 0-11-5-11-11v-6c0-6 5-11 11-11z" transform="translate(0 25) scale(1 .9)"/></svg>',
                id: 'cloudflare',
                title: 'Cloudflare',
                url: 'https://www.cloudflare.com/',
                type: 'simple',
                desc: 'Cloudflare'
            },
            {
                id: 'freedidi',
                icon: '👫🏻',
                title: '零度博客',
                desc: '零度博客',
                url: 'https://www.freedidi.com/',
                type: 'simple'
            },
            {
                id: 'vercel',
                icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><circle cx="64" cy="64" r="56" fill="#333333" stroke="#FFFFFF" stroke-width="4"/><polygon points="64,33 91,80 37,80" fill="#FFFFFF"/></svg>',
                title: 'Vercel',
                desc: 'vercel',
                url: 'https://vercel.com/',
                type: 'simple'
            },
            {
                id: 'zeabur',
                icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><line x1="84" y1="45" x2="22" y2="83" stroke="#FFFFFF" stroke-width="16" stroke-linecap="butt"/><polygon points="18,26 94,26 88,50 12,50" fill="#000000" stroke="#FFFFFF" stroke-width="4"/><polygon points="18,78 94,78 88,102 12,102" fill="#000000" stroke="#FFFFFF" stroke-width="4"/><polygon points="18,26 74,26 68,50 12,50" fill="#6B3FA0"/><polygon points="74,26 94,26 88,50 68,50" fill="#333333"/><line x1="84" y1="45" x2="22" y2="83" stroke="#333333" stroke-width="12" stroke-linecap="butt"/><polygon points="38,78 94,78 88,102 32,102" fill="#E8632B"/><polygon points="18,78 38,78 32,102 12,102" fill="#333333"/></svg>',
                title: 'Zeabur',
                desc: 'zeabur',
                url: 'https://zeabur.com/',
                type: 'simple'
            },
            {
                id: 'upstash',
                icon: '🌀',
                title: 'Upstash',
                desc: 'upstash',
                url: 'https://upstash.com/',
                type: 'simple'
            },
            {
                id: 'AddressGeneratorFe',
                icon: '🗺️',
                title: 'AddressGenerator',
                desc: '地址生成器',
                url: 'https://addr.f66.fun/',
                type: 'simple'
            }
        ]
    },
    // ==================== 🎬 视频聚合 ====================
    {
        builtin: true,
        key: 'videoData',
        kind: 'card',
        dynamic: true,
        label: '🎬 视频聚合',
        visible: true,
        cards: [
            {
                id: 'lunatv',
                icon: '🌗',
                title: 'LunaTV-Zb',
                desc: '综合影视平台',
                url: 'https://m.f66.fun/',
                type: 'expandable',
                subCards: [
                    {
                        icon: '🧝🏽‍',
                        title: 'KatTV-V',
                        desc: 'k.f66.fun',
                        url: 'https://k.f66.fun/'
                    },
                    {
                        icon: '🌜️',
                        title: 'MoonTV²-V',
                        desc: 'm2.f66.fun',
                        url: 'https://m2.f66.fun/'
                    },
                    {
                        icon: '🌈',
                        title: 'xiaoya',
                        desc: 'xy.f66.fun',
                        url: 'https://xy.f66.fun/'
                    },
                    {
                        icon: '🔍',
                        title: 'pansou',
                        desc: '网盘搜索',
                        url: 'https://pso.992929.xyz/'
                    }
                ]
            },
            {
                id: 'yingshiselin',
                icon: '🌲',
                title: '影视森林',
                desc: '资源导航',
                url: 'https://www.tvtv1.cc/',
                type: 'expandable',
                subCards: [
                    {
                        icon: '🔗',
                        content: '网址发布页',
                        url: 'https://www.tvtv.cc/'
                    },
                    {
                        icon: '🔗',
                        content: 'www.tvtv2.cc',
                        url: 'https://www.tvtv2.cc/'
                    }
                ]
            },
            {
                icon: '🎥',
                id: 'guanying',
                title: '七味观影',
                url: 'https://www.gmp4.com/',
                type: 'expandable',
                desc: '影视大全',
                subCards: [
                    {
                        icon: '🎬',
                        content: '七味网址发布',
                        url: 'https://www.qn63.com'
                    },
                    {
                        icon: '👻',
                        content: '观影网址发布(fq)',
                        url: 'https://www.挂了.com/'
                    },
                    {
                        icon: '🎭',
                        content: 'gying1(fq)',
                        url: 'https://www.xn--wcv59z.com/'
                    },
                    {
                        icon: '🎪',
                        content: 'gying2(fq)',
                        url: 'https://www.hgeme.com/'
                    }
                ]
            },
            {
                id: 'xiuluoyingshi',
                icon: '🐮',
                title: 'Moovie',
                desc: '影视聚合搜索',
                url: 'https://moovie.c2v2.com/',
                type: 'simple'
            },
            {
                id: 'maitianyingshi',
                icon: '‍🌾',
                title: '麦田影院',
                descClickable: 'mtyy.tv（网址发布）',
                descUrl: 'https://www.mtyy.tv/',
                url: 'https://mtyy5.com/',
                type: 'desc-clickable'
            },
            {
                id: 'changzhanquan',
                icon: '🎨',
                title: '厂长资源',
                desc: '影视在线观看',
                url: 'https://cz01.vip/',
                type: 'simple'
            },
            {
                icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#4682B4"/><text x="50" y="93" text-anchor="middle" font-family="Arial Narrow, Helvetica Neue, Arial, sans-serif" font-size="108" font-stretch="condensed" font-weight="700" fill="#fff" transform="scale(.78 1) translate(14 0)">dd</text></svg>',
                id: 'card_mq1d6eo1_l6xh',
                title: '低端影视',
                url: 'https://ddys.app/',
                type: 'simple',
                desc: '高清、品质'
            },
            {
                icon: '🍃',
                id: 'seedhub',
                title: 'SeedHub(下载站)',
                url: 'https://seeduck.cc/',
                type: 'desc-clickable',
                descClickable: '网址发布页',
                descUrl: 'https://seeduck.cc/zuixin-di-zhi/'
            },
            {
                icon: '🔻',
                id: 'butailing',
                title: '不太灵(下载站)',
                url: 'https://www.6bt0.com/',
                type: 'desc-clickable',
                descClickable: '网址发布页',
                descUrl: 'https://www.butailing.com/'
            },
            {
                icon: '🏰',
                id: 'dianyingtiantang',
                title: '电影天堂',
                url: 'https://www.dygod.vip/',
                type: 'simple',
                desc: '经典影视下载'
            },
            {
                icon: '📺',
                id: 'moovie',
                title: '雪落影视',
                url: 'https://v.xl01.eu.cc/',
                type: 'simple',
                desc: '资源丰富'
            },
            {
                id: '7080wang',
                icon: '📹',
                title: '7080网',
                desc: '怀旧影视资源',
                url: 'https://7080.wang/',
                type: 'simple'
            },
            {
                icon: '🐻',
                id: 'cilixiong',
                title: '磁力熊',
                url: 'https://www.cilixiong.org/',
                type: 'desc-clickable',
                descClickable: 'cilixiong.cc（备用）',
                descUrl: 'https://www.cilixiong.cc/',
                comment: 'F'
            },
            {
                icon: '🎬',
                id: '4kyingshi',
                title: '4K影视',
                url: 'https://www.4kvm.tv/',
                type: 'desc-clickable',
                descClickable: '网址发布页',
                descUrl: 'https://4kvm.site/',
                comment: 'F'
            },
            {
                icon: '🍚',
                id: 'fantaiying',
                title: '饭太硬(导航)',
                url: 'https://www.饭太硬.com/',
                type: 'desc-clickable',
                descClickable: '备用网址',
                descUrl: 'https://tvboxconf.clbug.com/',
                comment: 'F'
            }
        ]
    },
    // ==================== 📨 联系方式 ====================
    {
        builtin: true,
        key: 'emailData',
        kind: 'email',
        dynamic: false,
        label: '📨 联系方式',
        visible: true,
        cards: [
            {
                icon: '✉️',
                title: '邮箱1',
                address: 'aabb(AT)cc.cc',
                url: 'http://aabb.cc.cc',
                mailto: 'http://aabb.cc.cc'
            },
            {
                icon: '📪',
                title: '邮箱2',
                address: 'aaabbb(AT)cc.cc',
                url: 'http://aaabbb.cc.cc',
                mailto: 'http://aaabbb.cc.cc'
            },
            {
                icon: '📬',
                title: '邮箱3',
                address: 'abab(AT)cc.cc',
                url: 'http://abab.cc.cc',
                mailto: 'http://abab.cc.cc'
            },
            {
                icon: '📭',
                title: '邮箱4',
                address: 'n(AT)n29.net',
                url: 'https://o.n29.net',
                mailto: 'https://o.n29.net'
            },
            {
                icon: '🌐',
                title: '邮箱5',
                address: 'm(AT)mrr.cc',
                url: 'https://mrr.cc',
                mailto: 'https://mrr.cc'
            }
        ]
    },
    // ==================== 📨 其他联系方式 ====================
    {
        builtin: true,
        key: 'contactData',
        kind: 'contact',
        dynamic: false,
        label: '📨 其他联系方式',
        visible: true,
        cards: [
            {
                icon: '🐙',
                title: 'GitHub',
                desc: 'Repositories@GitHub.com',
                url: 'https://github.com/yumumao',
                descUrl: 'https://github.com/yumumao?tab=repositories'
            }
        ]
    },

    // ==================== 自定义大类（可在配置后台增删改） ====================
    // ----- 💟私人项目 -----
    {
        builtin: false,
        key: 'custom_moyq5cad_ezc0r',
        kind: 'card',
        dynamic: true,
        label: '💟私人项目',
        visible: true,
        encrypted: true,
        enc: {
            v: 1,
            alg: 'AES-GCM-256/PBKDF2-SHA256',
            iter: 300000,
            salt: 'L69VpYy9bsuioLab+07Y2g==',
            iv: 'tVO7r3MIHl1W70TZ',
            data: 'AvazivIfpan0jBCDHYSVzSuFbk5oqRyv/S55NezP2IHBplx1AfNDUKE47RmQeq2n7OL3dgevwaK7lc8pIJevy51Xfp1KtlFPdj0AxBRUfs6V7fBuXDjpBtVU2Eqs3TP8hEE0/5oZy/TwXgA14B3UnB6h6xe9FkSbtC84j+vU5zTQJPVOdTHNBr0Y7NSZxsL9Wx46Xaq4RIDDQeWUJb2NwpcoLWt4+jVvvrnMasxN6yGRyQal/YXgzajyLj/EtYvD1IOkcm6OxjzPtQY6UELSQVunZ8UVtGQPTKoR7Z1qHjjtHxkADwS8KCMdMw/XycneCoZ9U1h++nVd0TJ2AYLQ56+X2N4mx6Rr3AU4HMjEXPcoGlyFVKVgnKq/KD4G/2qmVQkT50ncx0DR13go/EA/Gchngt/zeH54+hIHgA7bI0JsdE4rwpKnduVVfbr+EXUBeJ4F59xiaSbcSJGMzmjEj3KQCrHk3MF40Vc9SlwVw1GEytBZ2Kzpg2ekM/MpOyeWeSoRpsBkpn281KHZTsO3+/U08yDfkXaxvKWT6dOcS9hB2pw4kipKjXfH20/h16cmPXiCBSzytifiso1TKqulJB3S6nGHotgXo1OcMK90wGKRH8SIB4IBrLNEOY1uVA1RIvGjQePvoIxe29T0Ic+U0QFtOd1eU9E/zmrpeWIlz+e0rqNdVdBlT5lyKiNfZnJzSgzH00hAvObtIaPYWvARriHiVlsriHofl+unjVP3gU476lif2C0iLV/Wyz/uWZnrco0vX2kp4G2AxM9y4fFPSCk522wMRtUFuzsMqdxPTcyA0u1GdbZ1PITcb+/5rypsqR5JpwugyoSknBzYxrD/RTB+S/HMMlqU9L13ldKsmgsYXDTJaJ/bYEmv6FlijMxIM5W0J8q+RCDoBll+F8/Dtwa2fPZg2TzkUmSArUtBz8zZJxa+Ov/F9O/X+AnX6ZbHQqyibFYTeJwRYKFMtPAH6uwUj+zdIV54u3AWnbKlY/pN3N3oG+mbgriy3XtitOXCXInWyCOAjHhVYlSRxjEajAA/NFTFxgcJVY0XW/dyNpNvAJEhr2uDDh3jGonlg8M5ZXu7N7PcH0HgIQjWgvSvDHkM+AhzMsYrp+pqFyQFNpzXyiaGJo6kWLcL5H4nVgOWl2GXvKTdOjnBQGm2+gUBTDDXHQnTeI6AGYl10A64cVKu7L6Ol2Hn82ZPIvpyMKvetHIT8Nzdm9fNRb8RXVJMwWBe+s+TWbkbBfgsas4h7v73lqUefzws5tOyBVpuAFTsAJ+8x0PkAfWnvIaiDoD1y3qnXlOaRGS/PqMBtb/MaSXhZTvaHxxvD1U3KM/OrqQsZRINjZ3Qld0o2NuH1fqE+N4SKq7XaZco/E5BRAj47F8PZB9w33HQT2RP+bwzTJJYls+g1Z5vBi3klIiI3bscDQ9xzPOlQOawbKhkxGucBEMDPUgz2SGUa7mjzr4GXyhJ3eXBI/gc+aONJVotxEAlXkO5eusc1sF2aYzsGH1eTgqWq6f6O5OKTEW15nJKdeFthuXAsWgOsMaFZFIxAz8HUokBv5RXYD3fnXYJIL2q9X6wYxX248GKepdt7StV9uEM9XEMZo6dRXK1lLQcyPUDNwY6NRqYVW47xeAKzL25NjCrfNs6NIDEZibNiO82caj7SSixAMaq8jTJup7qzvjcN4pfAeRyO4ojPDiy/IX1a+9HXQiufuUREqsGh1MCdzGdChuQiiAslGdiP/e7Pc9n0o9tWkepAbCRj/CyPlLe80/OHUfMlKwznHYQ3HWyG7j1F+yOQFYFqZS4tPlL7FjA6z2B/SswUj+lxnMYLtydS5Pdow9MdwJx'
        },
        cards: []
    }
];
