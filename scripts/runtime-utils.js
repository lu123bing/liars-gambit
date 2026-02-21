(function initRuntimeUtils(global){
    const { RANKS, RED_SUITS, DECK_COLORS } = global.LG_RUNTIME_CONFIG;

    const $ = id => document.getElementById(id);
    const $$ = sel => document.querySelectorAll(sel);
    const uuid = () => crypto.randomUUID ? crypto.randomUUID() : 'xxxx-xxxx-xxxx'.replace(/x/g,()=>(Math.random()*16|0).toString(16));
    const rng = (min,max) => Math.floor(Math.random()*(max-min+1))+min;
    const mkRoomCode = () => {
        const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        return Array.from({length:4},()=>ch[rng(0,ch.length-1)]).join('');
    };

    function showToast(msg, dur=2500){
        const el = document.createElement('div');
        el.className='toast'; el.textContent=msg;
        $('toast-container').appendChild(el);
        setTimeout(()=>{el.classList.add('toast-out');setTimeout(()=>el.remove(),300)},dur);
    }

    const FLAVOR_TEXTS=[
        '"谁是骗子？也许每个人都是。"',
        '"真话是最高级的欺骗。"',
        '"信任，是用来背叛的。"',
        '"每张牌都可能是谎言。"',
        '"诚实？这是我的信仰。"',
        '"你的眼神出卖了你的手牌。"',
        '"高明的骗子从不说谎。"',
        '"牌面之下，众生皆骗。"',
        '"质疑一切，包括你自己。"',
        '"用真诚打破质疑。"',
    ];

    function _randomFlavor(){
        const el=document.querySelector('.bar-flavor');
        if(el) el.textContent=FLAVOR_TEXTS[Math.floor(Math.random()*FLAVOR_TEXTS.length)];
    }

    function showScreen(name){
        $$('.screen').forEach(s=>s.classList.remove('active'));
        const s=$('screen-'+name); if(s) s.classList.add('active');
        if(name==='game') _randomFlavor();
    }

    function sortCards(cards){
        const ro={}; RANKS.forEach((r,i)=>ro[r]=i); ro['JOKER']=99;
        return [...cards].sort((a,b)=> a.rank===b.rank ? a.deck-b.deck : (ro[a.rank]??50)-(ro[b.rank]??50));
    }

    function cardToHTML(card, extra='', faceDown=false){
        if(!card) return '';
        const isRed=RED_SUITS.has(card.suit), isJ=card.rank==='JOKER';
        const sc=isJ?'card-joker':(isRed?'suit-red':'suit-black');
        const fd=faceDown?'face-down':'';
        const sym=DECK_COLORS[card.deck]?.symbol||'';
        const dr=isJ?(card.jokerType==='big'?'大王':'小王'):card.rank;
        const ds=isJ?'🃏':card.suit;
        return `<div class="card ${sc} ${fd} ${extra}" data-id="${card.id}" data-deck="${card.deck}">
            <span class="card-corner">${sym}</span><span class="card-rank">${dr}</span><span class="card-suit">${ds}</span>
        </div>`;
    }

    global.LG_RUNTIME_UTILS = {
        $,
        $$,
        uuid,
        rng,
        mkRoomCode,
        showToast,
        showScreen,
        FLAVOR_TEXTS,
        _randomFlavor,
        sortCards,
        cardToHTML,
    };
})(window);
