# 🎉 NightGames — Multiplayer Party App

Plateforme de jeux de soirée multijoueur en temps réel.  
Chaque joueur rejoint via un **code de salle** (comme Kahoot), sur son propre téléphone.

---

## 🎮 Jeux inclus

| Jeu | Joueurs | Description |
|-----|---------|-------------|
| 🦎 Caméléon Urbain | 3–8 | Incarne un rôle secret sans te faire deviner |
| 🔥 Vérité ou Défi | 2–10 | Vérités ou défis personnalisés |
| 🕵️ Mission Impossible | 3–10 | Missions secrètes à accomplir pendant la soirée |
| 🏆 Une Famille en Or | 4–12 | Devinez les réponses les plus populaires |
| 🐺 Loups Garous | 6–16 | Village vs loups-garous |
| 🕵️ Undercover Ultime | 3–20 | Mot secret, descriptions et votes d'élimination — démasque les infiltrés |
| 🎲 Game Changer | 2–8 | Les règles changent à chaque manche |

---

## 🚀 Setup en 5 minutes

### 1. Créer un projet Supabase (gratuit)

1. Aller sur [supabase.com](https://supabase.com) → **New project**
2. Choisir un nom et un mot de passe de DB
3. Attendre ~2 minutes que le projet soit prêt

### 2. Créer les tables

1. Dans Supabase → **SQL Editor** → **New query**
2. Copier-coller tout le contenu de `supabase_schema.sql`
3. Cliquer **Run**
4. Nouvelle requête → copier-coller tout le contenu de `supabase_seed.sql`
   (questions, rôles, cartes, règles — 200 questions pour Une Famille en
   Or, etc.) → **Run**

### 3. Récupérer les clés API

1. Supabase → **Settings** → **API**
2. Copier :
   - **Project URL** (ex: `https://abcdefgh.supabase.co`)
   - **anon public key** (longue chaîne JWT)

### 4. Configurer l'app

Ouvrir `js/config.js` et remplacer :

```js
const SUPABASE_URL  = 'https://VOTRE_PROJECT_ID.supabase.co';
const SUPABASE_ANON = 'VOTRE_ANON_KEY';
```

### 5. Héberger l'app

**Option A — GitHub Pages (gratuit, recommandé)**
1. Push ce repo sur GitHub
2. Settings → Pages → Branch: `main`, folder: `/`
3. URL disponible en ~30 secondes : `https://username.github.io/nightgames`

**Option B — Localhost (test rapide)**
```bash
npx serve .
# ou
python3 -m http.server 8080
```

---

## 📱 Comment jouer

1. **Le host** ouvre l'app → **Créer une salle** → entre son nom
2. Un **code à 4 lettres** s'affiche (ex: `KXQR`)
3. **Les autres joueurs** ouvrent la même URL → **Rejoindre** → entrent le code
4. Le host choisit le jeu et clique **Lancer la partie**
5. Chaque téléphone reçoit les instructions en temps réel ✨

---

## 🗂 Structure des fichiers

```
nightgames/
├── index.html              # Point d'entrée
├── css/
│   └── style.css           # Tous les styles
├── js/
│   ├── config.js           # 🔑 Vos clés Supabase (à remplir)
│   ├── db.js               # Couche Supabase (temps réel)
│   ├── lobby.js            # Création/rejoindre salle
│   ├── app.js              # Router + utilitaires partagés
│   └── games/
│       ├── cameleon.js
│       ├── verite.js
│       ├── mission.js
│       ├── famille.js
│       ├── loups.js
│       └── changer.js
└── supabase_schema.sql     # SQL à coller dans Supabase
```

---

## ➕ Ajouter un jeu

Créer `js/games/monjeu.js` et y enregistrer un engine :

```js
GameEngines['monjeu'] = {
  // Génère l'état initial (appelé par le host)
  initState(players) {
    return { phase: 'play', scores: {} };
  },
  // Monte le jeu dans le DOM
  mount(root, state, players, me, isHost, onStateChange, onEnd) {
    // root    : HTMLElement à remplir
    // state   : état courant du jeu (JSON)
    // players : liste des joueurs [{id, name, avatar, ...}]
    // me      : le joueur courant
    // isHost  : boolean
    // onStateChange(newState) : le host appelle ça pour pousser un nouvel état
    // onEnd() : retour au lobby
  }
};
```

Puis ajouter dans `GAMES_META` dans `lobby.js` :

```js
{ id:'monjeu', name:'Mon Jeu', icon:'🎯', min:2, color:'#ff3d6b', g1:'#ff3d6b', g2:'#ff9500' },
```

Et ajouter `<script src="js/games/monjeu.js"></script>` dans `index.html`.

---

## 🏗 Architecture technique

```
Host Phone                   Supabase (DB + Realtime)       Guest Phones
─────────                   ────────────────────────        ────────────
createRoom()        ──→     rooms table                
joinRoom()          ──→     players table              
                            ↓ broadcast                 ←── subscribeRoom()
hostStartGame()     ──→     rooms.game_state = {...}   ←── render(state)
onStateChange(ns)   ──→     UPDATE rooms               ←── render(newState)
```

**Principe clé** : seul le host écrit dans la base.  
Les guests sont 100% réactifs (lecture seule + subscription Realtime).

---

## 🛠 Dépendances

- [Supabase JS v2](https://github.com/supabase/supabase-js) — via CDN, aucune installation
- Google Fonts (Bebas Neue, Syne, Space Mono)
- Aucun framework JS, aucun build step

---

*Made with 🎉 for a great party*
