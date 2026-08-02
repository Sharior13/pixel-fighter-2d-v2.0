const characterSpriteConfigs = {
    luffy: {
        name: 'Luffy',
        frameWidth: 96,
        frameHeight: 96,
        layout: 'horizontal',
        scale: 4,
        
        spriteSheets: {
            main: 'characters/luffy/luffy-idle.png',
            walk: 'characters/luffy/luffy-walk.png',
            jump: 'characters/luffy/luffy-jump.png',
            hit: 'characters/luffy/luffy-hit.png',
            dash: 'characters/luffy/luffy-dash.png',
            block: 'characters/luffy/luffy-block.png',
            defeat: 'characters/luffy/luffy-lose.png',
            victory: 'characters/luffy/luffy-win.png',
            attack1: 'characters/luffy/luffy-attack1.png',
            attack2: 'characters/luffy/luffy-attack2.png',
            attack_basic:   'characters/luffy/luffy-basic.png',
            attack_special: 'characters/luffy/luffy-special.png',
            attack_ultimate: 'characters/luffy/luffy-ultimate.png'
        },
        
        animations: {
            idle: {
                sheet: 'main',
                startFrame: 0,
                frames: 6,
                frameDelay: 150,
                loop: true,
                row: 0
            },
            walk: {
                sheet: 'walk',
                startFrame: 0,
                frames: 8,
                frameDelay: 80,
                loop: true,
                row: 0
            },
            dash: {
                sheet: 'dash',
                startFrame: 0,
                frames: 2,
                frameDelay: 100,
                loop: true,
                row: 0
            },
            jump: {
                sheet: 'jump',  
                startFrame: 0,
                frames: 9,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            fall: {
                sheet: 'jump', 
                startFrame: 4,
                frames: 5,
                frameDelay: 100,
                loop: true,
                row: 0
            },
            attack1: {
                sheet: 'attack1', 
                startFrame: 0,
                frames: 7,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            attack2: {
                sheet: 'attack2', 
                startFrame: 0,
                frames: 8,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            attack_basic: {
                sheet: 'attack_basic', 
                startFrame: 0,
                frames: 3,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            attack_special: {
                sheet: 'attack_special',
                startFrame: 0,
                frames: 9,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            attack_ultimate: {
                sheet: 'attack_ultimate',
                startFrame: 0,
                frames: 10,
                frameDelay: 120,
                loop: false,
                row: 0
            },
            hit: {
                sheet: 'hit',
                startFrame: 0,
                frames: 4,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            block: {
                sheet: 'block',
                startFrame: 0,
                frames: 2,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            victory: {
                sheet: 'victory',
                startFrame: 0,
                frames: 4,
                frameDelay: 150,
                loop: true,
                row: 0
            },
            defeat: {
                sheet: 'defeat',
                startFrame: 0,
                frames: 4,
                frameDelay: 150,
                loop: false,
                row: 0
            }
        }
    },
    
    zoro: {
        name: 'Zoro',
        frameWidth: 96,
        frameHeight: 96,
        layout: 'horizontal',
        scale: 3.5,
        
        spriteSheets: {
            main: 'characters/zoro/zoro-idle.png',
            walk: 'characters/zoro/zoro-walk.png',
            jump: 'characters/zoro/zoro-jump.png',
            hit: 'characters/zoro/zoro-hit.png',
            dash: 'characters/zoro/zoro-dash.png',
            block: 'characters/zoro/zoro-block.png',
            defeat: 'characters/zoro/zoro-lose.png',
            victory: 'characters/zoro/zoro-win.png',
            attack1: 'characters/zoro/zoro-attack1.png',
            attack2: 'characters/zoro/zoro-attack2.png',
            attack_basic: 'characters/zoro/zoro-basic.png',
            attack_special: 'characters/zoro/zoro-special.png',
            attack_ultimate: 'characters/zoro/zoro-ultimate.png'
        },
        
        animations: {
            idle: {
                sheet: 'main',
                startFrame: 0,
                frames: 4,
                frameDelay: 150,
                loop: true,
                row: 0
            },
            walk: {
                sheet: 'walk',
                startFrame: 0,
                frames: 8,
                frameDelay: 80,
                loop: true,
                row: 0
            },
            dash: {
                sheet: 'dash',
                startFrame: 0,
                frames: 2,
                frameDelay: 100,
                loop: true,
                row: 0
            },
            jump: {
                sheet: 'jump',  
                startFrame: 0,
                frames: 6,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            fall: {
                sheet: 'jump', 
                startFrame: 3,
                frames: 3,
                frameDelay: 100,
                loop: true,
                row: 0
            },
            attack1: {
                sheet: 'attack1', 
                startFrame: 0,
                frames: 6,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            attack2: {
                sheet: 'attack2', 
                startFrame: 0,
                frames: 9,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            attack_basic: {
                sheet: 'attack_basic', 
                startFrame: 0,
                frames: 6,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            attack_special: {
                sheet: 'attack_special',
                startFrame: 0,
                frames: 15,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            attack_ultimate: {
                sheet: 'attack_ultimate',
                startFrame: 0,
                frames: 15,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            hit: {
                sheet: 'hit',
                startFrame: 0,
                frames: 4,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            block: {
                sheet: 'block',
                startFrame: 0,
                frames: 2,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            victory: {
                sheet: 'victory',
                startFrame: 0,
                frames: 6,
                frameDelay: 150,
                loop: false,
                row: 0
            },
            defeat: {
                sheet: 'defeat',
                startFrame: 0,
                frames: 5,
                frameDelay: 150,
                loop: false,
                row: 0
            }
        }
    },
    
    naruto: {
        name: 'Naruto',
        frameWidth: 96,
        frameHeight: 96,
        layout: 'horizontal',
        scale: 3.5,
        
        spriteSheets: {
            main: 'characters/naruto/naruto-idle.png',
            walk: 'characters/naruto/naruto-walk.png',
            jump: 'characters/naruto/naruto-jump.png',
            hit: 'characters/naruto/naruto-hit.png',
            dash: 'characters/naruto/naruto-dash.png',
            block: 'characters/naruto/naruto-block.png',
            defeat: 'characters/naruto/naruto-lose.png',
            victory: 'characters/naruto/naruto-win.png',
            attack1: 'characters/naruto/naruto-attack1.png',
            attack2: 'characters/naruto/naruto-attack2.png',
            attack_basic: 'characters/naruto/naruto-basic.png',
            attack_special: 'characters/naruto/naruto-special.png',
            attack_ultimate: 'characters/naruto/naruto-ultimate.png'
        },
        
        animations: {
            idle: {
                sheet: 'main',
                startFrame: 0,
                frames: 4,
                frameDelay: 150,
                loop: true,
                row: 0
            },
            walk: {
                sheet: 'walk',
                startFrame: 0,
                frames: 8,
                frameDelay: 80,
                loop: true,
                row: 0
            },
            dash: {
                sheet: 'dash',
                startFrame: 0,
                frames: 2,
                frameDelay: 100,
                loop: true,
                row: 0
            },
            jump: {
                sheet: 'jump',  
                startFrame: 0,
                frames: 8,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            fall: {
                sheet: 'jump', 
                startFrame: 3,
                frames: 3,
                frameDelay: 100,
                loop: true,
                row: 0
            },
            attack1: {
                sheet: 'attack1', 
                startFrame: 0,
                frames: 7,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            attack2: {
                sheet: 'attack2', 
                startFrame: 0,
                frames: 11,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            attack_basic: {
                sheet: 'attack_basic', 
                startFrame: 0,
                frames: 4,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            attack_special: {
                sheet: 'attack_special',
                startFrame: 0,
                frames: 10,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            attack_ultimate: {
                sheet: 'attack_ultimate',
                startFrame: 0,
                frames: 17,
                frameDelay: 120,
                loop: false,
                row: 0
            },
            hit: {
                sheet: 'hit',
                startFrame: 0,
                frames: 4,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            block: {
                sheet: 'block',
                startFrame: 0,
                frames: 2,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            victory: {
                sheet: 'victory',
                startFrame: 0,
                frames: 6,
                frameDelay: 150,
                loop: true,
                row: 0
            },
            defeat: {
                sheet: 'defeat',
                startFrame: 0,
                frames: 6,
                frameDelay: 150,
                loop: false,
                row: 0
            }
        }
    },
    
    kakashi: {
        name: 'Kakashi',
        frameWidth: 96,
        frameHeight: 96,
        layout: 'horizontal',
        scale: 3.5,
        
        spriteSheets: {
            main: 'characters/kakashi/kakashi-idle.png',
            walk: 'characters/kakashi/kakashi-walk.png',
            jump: 'characters/kakashi/kakashi-jump.png',
            hit: 'characters/kakashi/kakashi-hit.png',
            dash: 'characters/kakashi/kakashi-dash.png',
            block: 'characters/kakashi/kakashi-block.png',
            defeat: 'characters/kakashi/kakashi-lose.png',
            victory: 'characters/kakashi/kakashi-win.png',
            attack1: 'characters/kakashi/kakashi-attack1.png',
            attack2: 'characters/kakashi/kakashi-attack2.png',
            attack_basic: 'characters/kakashi/kakashi-basic.png',
            attack_special: 'characters/kakashi/kakashi-special.png',
            attack_ultimate: 'characters/kakashi/kakashi-ultimate.png'
        },
        
        animations: {
            idle: {
                sheet: 'main',
                startFrame: 0,
                frames: 4,
                frameDelay: 150,
                loop: true,
                row: 0
            },
            walk: {
                sheet: 'walk',
                startFrame: 0,
                frames: 8,
                frameDelay: 80,
                loop: true,
                row: 0
            },
            dash: {
                sheet: 'dash',
                startFrame: 0,
                frames: 2,
                frameDelay: 100,
                loop: true,
                row: 0
            },
            jump: {
                sheet: 'jump',  
                startFrame: 0,
                frames: 9,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            fall: {
                sheet: 'jump', 
                startFrame: 3,
                frames: 3,
                frameDelay: 100,
                loop: true,
                row: 0
            },
            attack1: {
                sheet: 'attack1', 
                startFrame: 0,
                frames: 6,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            attack2: {
                sheet: 'attack2', 
                startFrame: 0,
                frames: 8,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            attack_basic: {
                sheet: 'attack_basic', 
                startFrame: 0,
                frames: 4,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            attack_special: {
                sheet: 'attack_special',
                startFrame: 0,
                frames: 14,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            attack_ultimate: {
                sheet: 'attack_ultimate',
                startFrame: 0,
                frames: 16,
                frameDelay: 70,
                loop: false,
                row: 0
            },
            hit: {
                sheet: 'hit',
                startFrame: 0,
                frames: 4,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            block: {
                sheet: 'block',
                startFrame: 0,
                frames: 2,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            victory: {
                sheet: 'victory',
                startFrame: 0,
                frames: 6,
                frameDelay: 150,
                loop: true,
                row: 0
            },
            defeat: {
                sheet: 'defeat',
                startFrame: 0,
                frames: 10,
                frameDelay: 150,
                loop: false,
                row: 0
            }
        }
    },

    sasuke: {
        name: 'Sasuke',
        frameWidth: 96,
        frameHeight: 96,
        layout: 'horizontal',
        scale: 3.5,
        
        spriteSheets: {
            main: 'characters/sasuke/sasuke-idle.png',
            walk: 'characters/sasuke/sasuke-walk.png',
            jump: 'characters/sasuke/sasuke-jump.png',
            hit: 'characters/sasuke/sasuke-hit.png',
            dash: 'characters/sasuke/sasuke-dash.png',
            block: 'characters/sasuke/sasuke-block.png',
            defeat: 'characters/sasuke/sasuke-lose.png',
            victory: 'characters/sasuke/sasuke-win.png',
            attack1: 'characters/sasuke/sasuke-attack1.png',
            attack2: 'characters/sasuke/sasuke-attack2.png',
            attack_basic: 'characters/sasuke/sasuke-basic.png',
            attack_special: 'characters/sasuke/sasuke-special.png',
            attack_ultimate: 'characters/sasuke/sasuke-ultimate.png'
        },
        
        animations: {
            idle: {
                sheet: 'main',
                startFrame: 0,
                frames: 4,
                frameDelay: 150,
                loop: true,
                row: 0
            },
            walk: {
                sheet: 'walk',
                startFrame: 0,
                frames: 7,
                frameDelay: 80,
                loop: true,
                row: 0
            },
            dash: {
                sheet: 'dash',
                startFrame: 0,
                frames: 2,
                frameDelay: 100,
                loop: true,
                row: 0
            },
            jump: {
                sheet: 'jump',  
                startFrame: 0,
                frames: 9,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            fall: {
                sheet: 'jump', 
                startFrame: 3,
                frames: 3,
                frameDelay: 100,
                loop: true,
                row: 0
            },
            attack1: {
                sheet: 'attack1', 
                startFrame: 0,
                frames: 9,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            attack2: {
                sheet: 'attack2', 
                startFrame: 0,
                frames: 7,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            attack_basic: {
                sheet: 'attack_basic', 
                startFrame: 0,
                frames: 6,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            attack_special: {
                sheet: 'attack_special',
                startFrame: 0,
                frames: 10,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            attack_ultimate: {
                sheet: 'attack_ultimate',
                startFrame: 0,
                frames: 9,
                frameDelay: 120,
                loop: false,
                row: 0
            },
            hit: {
                sheet: 'hit',
                startFrame: 0,
                frames: 4,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            block: {
                sheet: 'block',
                startFrame: 0,
                frames: 2,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            victory: {
                sheet: 'victory',
                startFrame: 0,
                frames: 5,
                frameDelay: 150,
                loop: true,
                row: 0
            },
            defeat: {
                sheet: 'defeat',
                startFrame: 0,
                frames: 6,
                frameDelay: 150,
                loop: false,
                row: 0
            }
        }
    },

    ichigo: {
        name: 'Ichigo',
        frameWidth: 96,
        frameHeight: 96,
        layout: 'horizontal',
        scale: 3.5,
        
        spriteSheets: {
            main: 'characters/ichigo/ichigo-idle.png',
            walk: 'characters/ichigo/ichigo-walk.png',
            jump: 'characters/ichigo/ichigo-jump.png',
            hit: 'characters/ichigo/ichigo-hit.png',
            dash: 'characters/ichigo/ichigo-dash.png',
            block: 'characters/ichigo/ichigo-block.png',
            defeat: 'characters/ichigo/ichigo-lose.png',
            victory: 'characters/ichigo/ichigo-win.png',
            attack1: 'characters/ichigo/ichigo-attack1.png',
            attack2: 'characters/ichigo/ichigo-attack2.png',
            attack_basic: 'characters/ichigo/ichigo-basic.png',
            attack_special: 'characters/ichigo/ichigo-special.png',
            attack_ultimate: 'characters/ichigo/ichigo-ultimate.png'
        },
        
        animations: {
            idle: {
                sheet: 'main',
                startFrame: 0,
                frames: 4,
                frameDelay: 150,
                loop: true,
                row: 0
            },
            walk: {
                sheet: 'walk',
                startFrame: 0,
                frames: 8,
                frameDelay: 80,
                loop: true,
                row: 0
            },
            dash: {
                sheet: 'dash',
                startFrame: 0,
                frames: 2,
                frameDelay: 100,
                loop: true,
                row: 0
            },
            jump: {
                sheet: 'jump',  
                startFrame: 0,
                frames: 9,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            fall: {
                sheet: 'jump', 
                startFrame: 3,
                frames: 3,
                frameDelay: 100,
                loop: true,
                row: 0
            },
            attack1: {
                sheet: 'attack1', 
                startFrame: 0,
                frames: 6,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            attack2: {
                sheet: 'attack2', 
                startFrame: 0,
                frames: 8,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            attack_basic: {
                sheet: 'attack_basic', 
                startFrame: 0,
                frames: 4,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            attack_special: {
                sheet: 'attack_special',
                startFrame: 0,
                frames: 8,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            attack_ultimate: {
                sheet: 'attack_ultimate',
                startFrame: 0,
                frames: 12,
                frameDelay: 120,
                loop: false,
                row: 0
            },
            hit: {
                sheet: 'hit',
                startFrame: 0,
                frames: 4,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            block: {
                sheet: 'block',
                startFrame: 0,
                frames: 2,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            victory: {
                sheet: 'victory',
                startFrame: 0,
                frames: 7,
                frameDelay: 150,
                loop: true,
                row: 0
            },
            defeat: {
                sheet: 'defeat',
                startFrame: 0,
                frames: 5,
                frameDelay: 150,
                loop: false,
                row: 0
            }
        }
    },

    rukia: {
        name: 'Rukia',
        frameWidth: 96,
        frameHeight: 96,
        layout: 'horizontal',
        scale: 3.5,
        
        spriteSheets: {
            main: 'characters/rukia/rukia-idle.png',
            walk: 'characters/rukia/rukia-walk.png',
            jump: 'characters/rukia/rukia-jump.png',
            hit: 'characters/rukia/rukia-hit.png',
            dash: 'characters/rukia/rukia-dash.png',
            block: 'characters/rukia/rukia-block.png',
            defeat: 'characters/rukia/rukia-lose.png',
            victory: 'characters/rukia/rukia-win.png',
            attack1: 'characters/rukia/rukia-attack1.png',
            attack2: 'characters/rukia/rukia-attack2.png',
            attack_basic: 'characters/rukia/rukia-basic.png',
            attack_special: 'characters/rukia/rukia-special.png',
            attack_ultimate: 'characters/rukia/rukia-ultimate.png'
        },
        
        animations: {
            idle: {
                sheet: 'main',
                startFrame: 0,
                frames: 4,
                frameDelay: 150,
                loop: true,
                row: 0
            },
            walk: {
                sheet: 'walk',
                startFrame: 0,
                frames: 6,
                frameDelay: 80,
                loop: true,
                row: 0
            },
            dash: {
                sheet: 'dash',
                startFrame: 0,
                frames: 2,
                frameDelay: 100,
                loop: true,
                row: 0
            },
            jump: {
                sheet: 'jump',  
                startFrame: 0,
                frames: 8,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            fall: {
                sheet: 'jump', 
                startFrame: 3,
                frames: 3,
                frameDelay: 100,
                loop: true,
                row: 0
            },
            attack1: {
                sheet: 'attack1', 
                startFrame: 0,
                frames: 6,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            attack2: {
                sheet: 'attack2', 
                startFrame: 0,
                frames: 8,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            attack_basic: {
                sheet: 'attack_basic', 
                startFrame: 0,
                frames: 5,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            attack_special: {
                sheet: 'attack_special',
                startFrame: 0,
                frames: 12,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            attack_ultimate: {
                sheet: 'attack_ultimate',
                startFrame: 0,
                frames: 10,
                frameDelay: 150,
                loop: false,
                row: 0
            },
            hit: {
                sheet: 'hit',
                startFrame: 0,
                frames: 4,
                frameDelay: 80,
                loop: false,
                row: 0
            },
            block: {
                sheet: 'block',
                startFrame: 0,
                frames: 2,
                frameDelay: 100,
                loop: false,
                row: 0
            },
            victory: {
                sheet: 'victory',
                startFrame: 0,
                frames: 4,
                frameDelay: 150,
                loop: true,
                row: 0
            },
            defeat: {
                sheet: 'defeat',
                startFrame: 0,
                frames: 6,
                frameDelay: 150,
                loop: false,
                row: 0
            }
        }
    }
};

export { characterSpriteConfigs };