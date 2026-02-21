(function initCardEngine(global){
    class CardEngine {
        static createDecks(n){
            const cards=[];
            for(let d=0;d<n;d++){
                for(const suit of global.LG_RUNTIME_CONFIG.SUITS)
                    for(const rank of global.LG_RUNTIME_CONFIG.RANKS)
                        cards.push({id:`${d}-${suit}-${rank}`,deck:d,suit,rank,isJoker:false,jokerType:null});
                cards.push({id:`${d}-J-BIG`,deck:d,suit:'🃏',rank:'JOKER',isJoker:true,jokerType:'big'});
                cards.push({id:`${d}-J-SMALL`,deck:d,suit:'🃏',rank:'JOKER',isJoker:true,jokerType:'small'});
            }
            return cards;
        }

        static shuffle(cards){
            const a=[...cards];
            for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
            return a;
        }

        static deal(cards,n){
            const h=Array.from({length:n},()=>[]);
            cards.forEach((c,i)=>h[i%n].push(c));
            return h;
        }
    }

    global.LG_CARD_ENGINE = { CardEngine };
})(window);
