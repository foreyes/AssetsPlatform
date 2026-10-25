// Shared inspection presets, independent of catalogue identity.
export const COMMON_RENDER_PROFILES = [
  {
    "id": "clay",
    "label": "白模",
    "mode": "clay",
    "parameters": {
      "unlit": false,
      "lightDirection": [
        0.4,
        0.8,
        1
      ],
      "ambientColor": [
        1,
        1,
        1
      ],
      "ambientStrength": 0.42,
      "keyLightColor": [
        1,
        0.98,
        0.93
      ],
      "keyLightStrength": 0.85,
      "shadowColor": [
        0,
        0,
        0
      ],
      "baseTint": [
        1,
        1,
        1
      ],
      "saturation": 1,
      "contrast": 1,
      "bands": 3,
      "lightThreshold": 0.5
    },
    "implemented": true,
    "status": "browser-approximation",
    "description": "浏览器预览风格；不修改模型、贴图或原材质，不代表原游戏渲染器。",
    "unsupportedFeatures": [
      "原游戏自定义 Shader、场景灯光和后处理"
    ]
  },
  {
    "id": "toon",
    "label": "三阶卡通",
    "mode": "toon",
    "parameters": {
      "unlit": false,
      "lightDirection": [
        0.4,
        0.8,
        1
      ],
      "ambientColor": [
        1,
        1,
        1
      ],
      "ambientStrength": 0.42,
      "keyLightColor": [
        1,
        0.98,
        0.93
      ],
      "keyLightStrength": 0.85,
      "shadowColor": [
        0.62,
        0.67,
        0.58
      ],
      "baseTint": [
        1,
        1,
        1
      ],
      "saturation": 1,
      "contrast": 1,
      "bands": 3,
      "lightThreshold": 0.45
    },
    "implemented": true,
    "status": "browser-approximation",
    "description": "浏览器预览风格；不修改模型、贴图或原材质，不代表原游戏渲染器。",
    "unsupportedFeatures": [
      "原游戏自定义 Shader、场景灯光和后处理"
    ]
  },
  {
    "id": "paradise_marsh",
    "label": "自然柔光",
    "mode": "material",
    "parameters": {
      "lightDirection": [
        0.55,
        0.8,
        0.45
      ],
      "ambientColor": [
        1,
        1,
        1
      ],
      "ambientStrength": 0.45,
      "keyLightColor": [
        1,
        1,
        1
      ],
      "keyLightStrength": 0.8,
      "baseTint": [
        1,
        1,
        1
      ],
      "saturation": 1,
      "contrast": 1,
      "unlit": false,
      "shadowColor": [
        0.07809719443321228,
        0.1402921825647354,
        0.4245283007621765
      ],
      "bands": 0,
      "lightThreshold": 0.5
    },
    "implemented": true,
    "status": "browser-approximation",
    "description": "浏览器预览风格；不修改模型、贴图或原材质，不代表原游戏渲染器。",
    "unsupportedFeatures": [
      "原游戏自定义 Shader、场景灯光和后处理"
    ]
  },
  {
    "id": "cozy_island",
    "label": "双阶冷影",
    "mode": "toon",
    "parameters": {
      "unlit": false,
      "lightDirection": [
        0.55,
        0.8,
        0.45
      ],
      "ambientColor": [
        1,
        1,
        1
      ],
      "ambientStrength": 0.45,
      "keyLightColor": [
        1,
        1,
        1
      ],
      "keyLightStrength": 0.8,
      "baseTint": [
        1,
        1,
        1
      ],
      "saturation": 1,
      "contrast": 1,
      "unlit": false,
      "bands": 2,
      "lightThreshold": 0.45,
      "shadowColor": [
        0.48730966,
        0.61675125,
        0.75
      ]
    },
    "implemented": true,
    "status": "browser-approximation",
    "description": "浏览器预览风格；不修改模型、贴图或原材质，不代表原游戏渲染器。",
    "unsupportedFeatures": [
      "原游戏自定义 Shader、场景灯光和后处理"
    ]
  },
  {
    "id": "hamsters_away",
    "label": "双阶暖调",
    "mode": "toon",
    "parameters": {
      "unlit": false,
      "lightDirection": [
        0.55,
        0.8,
        0.45
      ],
      "ambientColor": [
        1,
        1,
        1
      ],
      "ambientStrength": 0.45,
      "keyLightColor": [
        1,
        1,
        1
      ],
      "keyLightStrength": 0.8,
      "baseTint": [
        1,
        1,
        1
      ],
      "saturation": 1,
      "contrast": 1,
      "unlit": false,
      "bands": 2,
      "lightThreshold": 0.35,
      "shadowColor": [
        0.827451,
        0.6154618,
        0.5792157
      ]
    },
    "implemented": true,
    "status": "browser-approximation",
    "description": "浏览器预览风格；不修改模型、贴图或原材质，不代表原游戏渲染器。",
    "unsupportedFeatures": [
      "原游戏自定义 Shader、场景灯光和后处理"
    ]
  }
];
export function commonIndexedProfiles(existing=[]){const map=new Map(existing.map(p=>[p.id,p.id==='material'?{...p,label:'源材质'}:p]));for(const p of COMMON_RENDER_PROFILES)map.set(p.id,structuredClone(p));return [...map.values()];}
