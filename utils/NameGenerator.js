/**
 * Class to generate random names
 */
class NameGenerator {
  constructor() {
    this.adjectives = [
      "Swift", "Brave", "Mighty", "Noble", "Clever", "Bright", "Quick", "Epic", 
      "Cosmic", "Mystic", "Golden", "Silver", "Crystal", "Shadow", "Royal",
      "Stellar", "Hyper", "Super", "Mega", "Ultra", "Alpha", "Omega", "Neo"
    ];
    
    this.nouns = [
      "Warrior", "Knight", "Explorer", "Wizard", "Rogue", "Guardian", "Hunter", 
      "Voyager", "Scholar", "Pioneer", "Champion", "Hero", "Captain", "Ace",
      "Ranger", "Pilot", "Agent", "Commander", "Ninja", "Samurai", "Phoenix"
    ];
  }
  
  /**
   * Generate a random username
   */
  generate() {
    const randomAdj = this.adjectives[Math.floor(Math.random() * this.adjectives.length)];
    const randomNoun = this.nouns[Math.floor(Math.random() * this.nouns.length)];
    const randomNumber = Math.floor(Math.random() * 100);
    return `${randomAdj}${randomNoun}${randomNumber}`;
  }
}

module.exports = NameGenerator;