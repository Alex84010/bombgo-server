// server.js - Serveur Socket.io pour BombGo Duo
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Variables pour le matchmaking
let waitingPlayer = null;
const games = new Map();

console.log('🚀 Serveur BombGo Duo démarré');

io.on('connection', (socket) => {
  console.log('👤 Joueur connecté:', socket.id);

  // Matchmaking
  socket.on('find-match', (playerData) => {
    console.log('🔍 Recherche de match pour:', playerData.nickname);

    if (waitingPlayer && waitingPlayer.id !== socket.id) {
      // Match trouvé !
      const gameId = `game_${Date.now()}`;
      const player1 = waitingPlayer;
      const player2 = {
        id: socket.id,
        nickname: playerData.nickname,
        character: playerData.character
      };

      // Créer la partie
      games.set(gameId, {
        id: gameId,
        player1: player1,
        player2: player2,
        state: {
          player1Lives: 3,
          player2Lives: 3,
          player1X: 100,
          player1Y: 450,
          player1VelX: 0,
          player1Anim: 'turn',
          player2X: 700,
          player2Y: 450,
          player2VelX: 0,
          player2Anim: 'turn',
          currentLevel: 0,
          stars: Array(12).fill(true),
          bombs: [],
          gameOver: false,
          winner: null
        }
      });

      // Joindre les deux joueurs au salon
      player1.socket.join(gameId);
      socket.join(gameId);

      // Notifier les joueurs
      player1.socket.emit('match-found', {
        gameId: gameId,
        isPlayer1: true,
        opponent: { nickname: player2.nickname, character: player2.character },
        myCharacter: player1.character
      });

      socket.emit('match-found', {
        gameId: gameId,
        isPlayer1: false,
        opponent: { nickname: player1.nickname, character: player1.character },
        myCharacter: player2.character
      });

      console.log(`✅ Match créé: ${player1.nickname} vs ${player2.nickname}`);
      waitingPlayer = null;

    } else {
      // Mettre en attente
      waitingPlayer = {
        id: socket.id,
        socket: socket,
        nickname: playerData.nickname,
        character: playerData.character
      };
      console.log('⏳ Joueur en attente:', playerData.nickname);
    }
  });

  // Annuler le matchmaking
  socket.on('cancel-matchmaking', () => {
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
      console.log('🚫 Matchmaking annulé');
    }
  });

  // Mise à jour de position
  socket.on('update-position', (data) => {
    const game = games.get(data.gameId);
    if (!game) return;

    const isPlayer1 = game.player1.id === socket.id;
    const playerKey = isPlayer1 ? 'player1' : 'player2';

    // Mettre à jour l'état
    game.state[`${playerKey}X`] = data.x;
    game.state[`${playerKey}Y`] = data.y;
    game.state[`${playerKey}VelX`] = data.velX;
    game.state[`${playerKey}Anim`] = data.anim;

    // Envoyer à l'autre joueur seulement
    socket.to(data.gameId).emit('opponent-update', {
      x: data.x,
      y: data.y,
      velX: data.velX,
      anim: data.anim
    });
  });

  // Collecte d'étoile
  socket.on('collect-star', (data) => {
    const game = games.get(data.gameId);
    if (!game) return;

    game.state.stars[data.starIndex] = false;

    // Vérifier si toutes les étoiles sont collectées
    const activeStars = game.state.stars.filter(s => s).length;

    if (activeStars === 0) {
      // Niveau terminé
      game.state.currentLevel = (game.state.currentLevel + 1) % 5;
      game.state.stars = Array(12).fill(true);

      // Ajouter une bombe
      const x = data.playerX < 400 ? (400 + Math.floor(Math.random() * 400)) : Math.floor(Math.random() * 400);
      const vx = -200 + Math.floor(Math.random() * 400);
      game.state.bombs.push({ x, y: 16, vx });

      // Notifier les deux joueurs
      io.to(data.gameId).emit('level-complete', {
        newLevel: game.state.currentLevel,
        bombs: game.state.bombs
      });
    } else {
      // Juste mettre à jour les étoiles
      io.to(data.gameId).emit('star-collected', {
        starIndex: data.starIndex
      });
    }
  });

  // Collision avec bombe
  socket.on('hit-bomb', (data) => {
    const game = games.get(data.gameId);
    if (!game) return;

    const isPlayer1 = game.player1.id === socket.id;
    const playerKey = isPlayer1 ? 'player1Lives' : 'player2Lives';

    game.state[playerKey]--;

    if (game.state[playerKey] <= 0) {
      game.state.gameOver = true;
      game.state.winner = isPlayer1 ? 'player2' : 'player1';

      io.to(data.gameId).emit('game-over', {
        winner: game.state.winner,
        player1Lives: game.state.player1Lives,
        player2Lives: game.state.player2Lives
      });

      console.log(`🎮 Partie terminée: ${game.state.winner} gagne!`);
    } else {
      io.to(data.gameId).emit('lives-update', {
        player1Lives: game.state.player1Lives,
        player2Lives: game.state.player2Lives,
        bombIndex: data.bombIndex
      });
    }
  });

  // Déconnexion
  socket.on('disconnect', () => {
    console.log('👋 Joueur déconnecté:', socket.id);

    // Retirer du matchmaking
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
    }

    // Trouver et terminer la partie en cours
    for (const [gameId, game] of games.entries()) {
      if (game.player1.id === socket.id || game.player2.id === socket.id) {
        const winner = game.player1.id === socket.id ? 'player2' : 'player1';
        socket.to(gameId).emit('opponent-disconnected', { winner });
        games.delete(gameId);
        console.log(`🗑️ Partie supprimée: ${gameId}`);
      }
    }
  });
});

// Route de test
app.get('/', (req, res) => {
  res.send(`
    <h1>🎮 BombGo Duo Server</h1>
    <p>Serveur Socket.io actif</p>
    <p>Joueurs en attente: ${waitingPlayer ? 1 : 0}</p>
    <p>Parties actives: ${games.size}</p>
  `);
});

http.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur le port ${PORT}`);
});
