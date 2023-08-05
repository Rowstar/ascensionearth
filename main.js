let deck = [];
let currentCard = null;

function startGame() {
    deck = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    shuffle(deck);
    currentCard = deck.pop();
    document.getElementById('current-card').innerText = currentCard;
    document.getElementById('game-board').style.display = 'block';
    document.getElementById('message').innerText = '';
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function guessHigher() {
    guess(true);
}

function guessLower() {
    guess(false);
}

function guess(isHigher) {
    const nextCard = deck.pop();
    const isCorrect = isHigher ? nextCard > currentCard : nextCard < currentCard;
    currentCard = nextCard;
    document.getElementById('current-card').innerText = currentCard;
    document.getElementById('message').innerText = isCorrect ? 'Correct!' : 'Wrong!';
    if (deck.length === 0) {
        document.getElementById('game-board').style.display = 'none';
        document.getElementById('message').innerText += ' Game over!';
    }
}

document.getElementById('start').addEventListener('click', startGame);
document.getElementById('higher').addEventListener('click', guessHigher);
document.getElementById('lower').addEventListener('click', guessLower);

