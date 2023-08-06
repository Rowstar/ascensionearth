class Player {
    constructor() {
        this.actionCards = ['Meditate', 'Mountain Journey', 'Cave Journey', 'Earth Advancement'];
        this.gameCards = [];
        this.spells = [];
        this.artifacts = [];
        this.teachings = [];
        this.ascensionPower = 0;
    }    
    meditate() {
    // Draw 4 game cards
    for (let i = 0; i < 4; i++) {
      this.gameCards.push(game.drawGameCard());
    }
  }
}

class Game {
    constructor() {
        this.players = [new Player(), new Player()];
        this.gameCards = ['Blue Lotus', 'Magical Butterfly', 'Temple Priestess', 'Happy Holy Man', 'Ancient Turtle', 'Ethereal Cactus', 'Kundalini Snake', 'Mystical Mushrooms', 'Astral Cockatoo', 'Druid', 'Enlightened Dolphin', 'Cosmic Toad', 'Shaman', 'Master Monk', 'Tree of Life'];
        this.spells = ['Empower the Meek', 'Channel Group Energy', 'Tribal Spirits', 'Third Eye Awakening'];
        this.artifacts = ['Mystic Orb', 'Spell Staff', 'Giant Crystal', 'Lucky Beads', 'Stone of Balance', 'Reincarnation Crystal', 'Sacred Plant Seed', 'Magnetic Crystal', 'Spirit Totem', 'Extra Terrestrial Artifact', 'Crystal Seeker Goggles', 'Mysterious Totem', 'Cosmic Robes'];
        this.teachings = ['Teaching 1', 'Teaching 2', 'Teaching 3']; // Replace with actual teachings
        this.shuffle(this.gameCards);
        this.shuffle(this.spells);
        this.shuffle(this.artifacts);
        this.shuffle(this.teachings);
        this.mountainJourneyRewardPool = [];
        this.caveJourneyRewardPool = [];
    }

    drawGameCard() {
    return this.gameCards.pop();
  }

    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

rollForRewards() {
    this.mountainJourneyRewardPool.push(this.rollReward());
    this.caveJourneyRewardPool.push(this.rollReward());
    document.getElementById('mountain-journey-reward-pool').innerHTML = this.mountainJourneyRewardPool.map(reward => `<li>${reward.type}</li>`).join('');
    document.getElementById('cave-journey-reward-pool').innerHTML = this.caveJourneyRewardPool.map(reward => `<li>${reward.type}</li>`).join('');
}

    rollReward() {
        const roll = Math.floor(Math.random() * 6) + 1;
        switch (roll) {
            case 1: return { type: 'Crystal Shard', ascensionPower: 5 };
            case 2: return { type: 'Crystal Shard', ascensionPower: 10 };
            case 3: return { type: 'Game Card', card: this.gameCards.pop() };
            case 4: return { type: 'Artifact', artifact: this.artifacts.pop(), ascensionPower: 10 };
            case 5: return { type: 'Spell', spell: this.spells.pop(), ascensionPower: 15 };
            case 6: return { type: 'Crystal', ascensionPower: 20 };
        }
    }
}

const game = new Game();
game.rollForRewards();
console.log(game.mountainJourneyRewardPool);
console.log(game.caveJourneyRewardPool);
