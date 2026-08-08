const keys = {
    w: false,
    s: false,
    a: false,
    d: false,
    ArrowLeft: false, // attack1
    ArrowRight: false, // attack2
    ArrowUp: false, // basic
    ArrowDown: false, // special
    v: false, // ultimate
    Shift: false,
    ' ': false
};

const actionTriggered = {
    jump: false,
    dash: false,
    attack1: false,
    attack2: false,
    basic: false,
    special: false,
    ultimate: false,
    block: false
};

//normalize key to lowercase (except for special keys and arrow keys)
function normalizeKey(key) {
    //dont normalize arrow keys, space, or Shift
    if(key === ' ' || key === 'Shift' || key.startsWith('Arrow')){
        return key;
    }
    return key.toLowerCase();
}

//handle player inputs
window.addEventListener('keydown', (event) => {
    const normalizedKey = normalizeKey(event.key);
    if(normalizedKey in keys){
        keys[normalizedKey] = true;
    }
});

window.addEventListener('keyup', (event) => {
    const normalizedKey = normalizeKey(event.key);
    if(normalizedKey in keys){
        keys[normalizedKey] = false;

        //reset action triggers
        if(normalizedKey === 'w' || normalizedKey === ' '){
            actionTriggered.jump = false;
        }
        if(normalizedKey === 'Shift'){
            actionTriggered.dash = false;
        }
        if(normalizedKey === 'ArrowLeft') actionTriggered.attack1 = false;
        if(normalizedKey === 'ArrowRight') actionTriggered.attack2 = false;
        if(normalizedKey === 'ArrowUp') actionTriggered.basic = false;
        if(normalizedKey === 'ArrowDown') actionTriggered.special = false;
        if(normalizedKey === 'v') actionTriggered.ultimate = false;
    }
});

window.addEventListener('blur', () => {
    //reset all keys
    Object.keys(keys).forEach(key => {
        keys[key] = false;
    });
    
    //reset all action triggers
    Object.keys(actionTriggered).forEach(action => {
        actionTriggered[action] = false;
    });
});

//build this frame's input list from the current key state. Pure - no
//network/prediction/tagging here, just "what would a player holding these
//keys want to do right now". Shared by socket.js (networked matches - tags
//with seq/tick and emits) and localMatch.js (bot matches - feeds straight
//into the local sim's processInput, no network round-trip).
function collectFrameInputs() {
    const inputs = [];

    let direction = 0;
    if (keys.a) direction = -1;
    if (keys.d) direction = 1;
    inputs.push({ type: "move", direction });

    //jump
    if ((keys.w || keys[' ']) && !actionTriggered.jump) {
        inputs.push({ type: "jump" });
        actionTriggered.jump = true;
    }

    //dash
    if (keys.Shift && !actionTriggered.dash) {
        inputs.push({ type: "dash" });
        actionTriggered.dash = true;
    }

    //attacks
    if (keys.ArrowLeft && !actionTriggered.attack1) {
        inputs.push({ type: "attack", ability: "attack1" });
        actionTriggered.attack1 = true;
    }
    if (keys.ArrowRight && !actionTriggered.attack2) {
        inputs.push({ type: "attack", ability: "attack2" });
        actionTriggered.attack2 = true;
    }
    if (keys.ArrowUp && !actionTriggered.basic) {
        inputs.push({ type: "attack", ability: "basic" });
        actionTriggered.basic = true;
    }
    if (keys.ArrowDown && !actionTriggered.special) {
        inputs.push({ type: "attack", ability: "special" });
        actionTriggered.special = true;
    }
    if (keys.v && !actionTriggered.ultimate) {
        inputs.push({ type: "attack", ability: "ultimate" });
        actionTriggered.ultimate = true;
    }

    //block
    if (keys.s) {
        if (!actionTriggered.block) {
            inputs.push({ type: "block", activate: true });
            actionTriggered.block = true;
        }
    } else {
        if (actionTriggered.block) {
            inputs.push({ type: "block", activate: false });
            actionTriggered.block = false;
        }
    }

    return inputs;
}

export { keys, actionTriggered, collectFrameInputs };