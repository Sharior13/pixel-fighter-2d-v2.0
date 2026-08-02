const CHARACTERS = {
    luffy: {
        id: "luffy",
        name: "Luffy",
        stats: {
            maxHealth: 1150,
            speed: 5.0,
            jumpForce: 15,
            weight: 1.15
        },
        abilities: {
            attack1: { id: "gum_pistol" },
            attack2: { id: "gum_whip" },
            basic: { id: "gum_punch" },
            special: { id: "gum_baloon" },
            ultimate: { id: "gum_gatling" }
        }
    },
    zoro: {
        id: "zoro",
        name: "Zoro",
        stats: {
            maxHealth: 1000,
            speed: 5.5,
            jumpForce: 15,
            weight: 1.1
        },
        abilities: {
            attack1: { id: "rolling_slash" },
            attack2: { id: "sword_slash" },
            basic: { id: "zoro_slash" },
            special: { id: "santoriu" },
            ultimate: { id: "whirlwind" }
        }
    },
    ichigo: {
        id: "ichigo",
        name: "Ichigo",
        stats: {
            maxHealth: 950,
            speed: 7.0,
            jumpForce: 15,
            weight: 1.0
        },
        abilities: {
            attack1: { id: "shikai" },
            attack2: { id: "sword_slash" },
            basic: { id: "ichigo_slash" },
            special: { id: "12_folds" },
            ultimate: { id: "ichigo_bankai" }
        }
    },
    rukia: {
        id: "rukia",
        name: "Rukia",
        stats: {
            maxHealth: 850,
            speed: 6.5,
            jumpForce: 15,
            weight: 0.7
        },
        abilities: {
            attack1: { id: "rukia_punch" },
            attack2: { id: "rukia_kick" },
            basic: { id: "rukia_low_kick" },
            special: { id: "hado" },
            ultimate: { id: "rukia_bankai" }
        }
    }
};

const getCharacterData = (characterId)=>{
    return CHARACTERS[characterId] || null;
};

const getAllCharacterIds = ()=>{
    return Object.keys(CHARACTERS);
};

const validateCharacter = (characterId)=>{
    return CHARACTERS.hasOwnProperty(characterId);
};

const getRandomCharacter = ()=>{
    const ids = getAllCharacterIds();
    return ids[Math.floor(Math.random() * ids.length)];
};

module.exports = { CHARACTERS, getCharacterData, getAllCharacterIds, validateCharacter, getRandomCharacter };