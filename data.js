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
    version:   '2026-05-15-006',
    updatedAt: '2026-05-15T13:42:41.555Z',
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
                        desc: 'f66.fun/fun(密码：zz1001)',
                        url: 'https://www.jianguoyun.com/p/DemLEOwQpYHpBRiwtscFIAA'
                    },
                    {
                        icon: '📥',
                        title: '临时加密上传',
                        desc: 'n29.net/net (密码：临时ZZ)',
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
                id: 'ohthercalc-tools',
                icon: '👨🏻‍🔧',
                title: '在线工具',
                url: 'https://ol.woobx.cn/',
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
                id: 'wrongbook',
                icon: '🗳',
                title: 'AI错题本',
                url: 'https://wn.n29.net/',
                type: 'desc-clickable',
                descClickable: 'wn.n29.net',
                descUrl: 'https://wn.n29.net/'
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
                id: 'qwen',
                icon: '🧞',
                title: 'Qwen',
                desc: '阿里千问等集合',
                url: 'https://chat.qwen.ai/',
                type: 'expandable',
                subCards: [
                    {
                        icon: '🤿',
                        title: 'DeepSeek',
                        desc: '深度求索',
                        url: 'https://www.deepseek.com/'
                    },
                    {
                        icon: '🍏',
                        title: '腾讯元宝',
                        desc: '腾讯AI助手',
                        url: 'https://yuanbao.tencent.com/'
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
                id: 'cloudflare',
                icon: '🌩️',
                title: 'Cloudflare',
                desc: 'Cloudflare',
                url: 'https://www.cloudflare.com/',
                type: 'simple'
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
                id: 'vaultwarden',
                icon: '🛡',
                title: 'Vaultwarden',
                desc: 'Bitwarden密码管理',
                url: 'https://vbw.n29.net/',
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
                id: 'guanying',
                icon: '🎥',
                title: '七味',
                desc: '影视大全',
                url: 'https://www.gmp4.com/',
                type: 'expandable',
                subCards: [
                    {
                        icon: '🎬',
                        content: '七味网址发布',
                        url: 'https://www.qn63.com'
                    },
                    {
                        icon: '🍿',
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
                id: 'cilixiong',
                icon: '🐻',
                title: '磁力熊',
                descClickable: 'cilixiong.cc（备用）',
                descUrl: 'https://www.cilixiong.cc/',
                url: 'https://www.cilixiong.org/',
                type: 'desc-clickable'
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
                id: 'seedhub',
                icon: '🍃',
                title: 'SeedHub(下载站)',
                desc: '网盘下载',
                url: 'https://www.seedhub.cc/',
                type: 'simple'
            },
            {
                id: 'butailing',
                icon: '🔻',
                title: '不太灵(下载站)',
                desc: '小众影视下载',
                url: 'https://www.6bt0.com/',
                type: 'simple'
            },
            {
                id: '4kyingshi',
                icon: '🎬',
                title: '4K影视',
                desc: '高清在线影视',
                url: 'https://www.4kvm.tv/',
                type: 'simple'
            },
            {
                id: 'dianyingtiantang',
                icon: '🏰',
                title: '电影天堂',
                desc: '经典影视下载',
                url: 'https://www.dygod.net/',
                type: 'simple'
            },
            {
                id: 'moovie',
                icon: '📺',
                title: '修罗影视',
                desc: '资源丰富',
                url: 'https://xlys.me/',
                type: 'simple'
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
                id: 'fantaiying',
                icon: '🍚',
                title: '饭太硬(导航)',
                descClickable: '备用网址',
                descUrl: 'https://tvboxconf.clbug.com/',
                url: 'https://www.饭太硬.com/',
                type: 'desc-clickable'
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
                address: 'cocoa(AT)cc.cc',
                url: 'http://cocoa.cc.cc',
                mailto: 'http://cocoa.cc.cc'
            },
            {
                icon: '📭',
                title: '邮箱4',
                address: 'abab(AT)cc.cc',
                url: 'http://abab.cc.cc',
                mailto: 'http://abab.cc.cc'
            },
            {
                icon: '📠',
                title: '邮箱5',
                address: 'yumumao(AT)cc.cc',
                url: 'http://yumumao.cc.cc',
                mailto: 'http://yumumao.cc.cc'
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
            salt: 'VGKs8Kq0UxMM3U636nzqNw==',
            iv: 'H726ZjjXcbfRc2+U',
            data: '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'
        },
        cards: []
    }
];
