(() => {
  "use strict";

  const CHESS_JS_URL =
    "https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js";

  const STOCKFISH_PATH = "stockfish-18-lite-single.js";

  const PIECES = {
    w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
    b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
  };

  let game;
  let selectedSquare = null;
  let legalTargets = [];
  let boardFlipped = false;
  let aiEnabled = true;
  let aiThinking = false;
  let stockfish = null;
  let stockfishReady = false;
  let pendingEngineMove = false;

  const board = document.getElementById("board");

  if (!board) {
    document.body.innerHTML =
      '<p style="font-family:Arial;padding:20px">Missing <code>&lt;div id="board"&gt;&lt;/div&gt;</code> in index.html.</p>';
    return;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function start() {
    try {
      if (typeof window.Chess === "undefined") {
        await loadScript(CHESS_JS_URL);
      }

      game = new window.Chess();

      buildInterface();
      initializeStockfish();
      render();
    } catch (error) {
      console.error(error);

      board.innerHTML =
        '<p style="padding:20px">Could not load chess.js. Check your internet connection and refresh.</p>';
    }
  }

  function buildInterface() {
    injectStyles();

    const wrapper = document.createElement("div");
    wrapper.className = "chess-app";

    const boardParent = board.parentElement;
    boardParent.insertBefore(wrapper, board);
    wrapper.appendChild(board);

    board.className = "chess-board";

    const panel = document.createElement("aside");
    panel.className = "game-panel";

    panel.innerHTML = `
      <h2>Royal Chess</h2>

      <div class="status-card">
        <div id="gameStatus">White to move</div>
        <small id="engineStatus">Loading Stockfish...</small>
      </div>

      <label class="control-label">
        Game mode
        <select id="gameMode">
          <option value="ai">Play versus computer</option>
          <option value="local">Two players</option>
        </select>
      </label>

      <label class="control-label">
        AI difficulty
        <select id="difficulty">
          <option value="3">Beginner</option>
          <option value="6" selected>Easy</option>
          <option value="9">Medium</option>
          <option value="12">Hard</option>
          <option value="15">Expert</option>
        </select>
      </label>

      <div class="button-grid">
        <button id="newGame">New game</button>
        <button id="undoMove">Undo</button>
        <button id="flipBoard">Flip board</button>
        <button id="copyPgn">Copy PGN</button>
      </div>

      <h3>Move history</h3>
      <div id="moveHistory" class="move-history">No moves yet</div>
    `;

    wrapper.appendChild(panel);

    document
      .getElementById("gameMode")
      .addEventListener("change", (event) => {
        aiEnabled = event.target.value === "ai";
        newGame();
      });

    document
      .getElementById("difficulty")
      .addEventListener("change", () => {
        if (stockfishReady) {
          configureStockfish();
        }
      });

    document
      .getElementById("newGame")
      .addEventListener("click", newGame);

    document
      .getElementById("undoMove")
      .addEventListener("click", undoMove);

    document
      .getElementById("flipBoard")
      .addEventListener("click", () => {
        boardFlipped = !boardFlipped;
        renderBoard();
      });

    document
      .getElementById("copyPgn")
      .addEventListener("click", copyPgn);
  }

  function injectStyles() {
    const style = document.createElement("style");

    style.textContent = `
      .chess-app {
        display: flex;
        gap: 24px;
        align-items: flex-start;
        justify-content: center;
        flex-wrap: wrap;
        width: min(100%, 1050px);
        margin: 0 auto;
      }

      .chess-board {
        width: min(82vw, 560px);
        aspect-ratio: 1;
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        border: 6px solid #342e2a;
        border-radius: 10px;
        overflow: hidden;
        box-shadow: 0 18px 45px rgba(0, 0, 0, 0.35);
      }

      .chess-square {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 0;
        padding: 0;
        cursor: pointer;
        font-size: clamp(30px, 7vw, 58px);
        line-height: 1;
        user-select: none;
      }

      .chess-square.light {
        background: #f0d9b5;
      }

      .chess-square.dark {
        background: #b58863;
      }

      .chess-square.selected {
        box-shadow: inset 0 0 0 5px rgba(255, 226, 92, 0.9);
      }

      .chess-square.legal::after {
        content: "";
        position: absolute;
        width: 24%;
        height: 24%;
        border-radius: 50%;
        background: rgba(30, 30, 30, 0.32);
      }

      .chess-square.capture::after {
        content: "";
        position: absolute;
        inset: 8%;
        border-radius: 50%;
        border: 5px solid rgba(110, 20, 20, 0.45);
      }

      .chess-square.last-move {
        background-image: linear-gradient(
          rgba(255, 235, 59, 0.28),
          rgba(255, 235, 59, 0.28)
        );
      }

      .piece {
        position: relative;
        z-index: 2;
        filter: drop-shadow(0 2px 1px rgba(0, 0, 0, 0.28));
      }

      .coordinate {
        position: absolute;
        font: bold 11px Arial, sans-serif;
        opacity: 0.75;
        z-index: 3;
      }

      .coordinate.file {
        right: 4px;
        bottom: 2px;
      }

      .coordinate.rank {
        left: 4px;
        top: 2px;
      }

      .game-panel {
        width: min(88vw, 330px);
        background: #262626;
        color: #ffffff;
        padding: 22px;
        border-radius: 14px;
        box-shadow: 0 18px 45px rgba(0, 0, 0, 0.25);
        font-family: Arial, sans-serif;
      }

      .game-panel h2 {
        margin: 0 0 16px;
      }

      .game-panel h3 {
        margin-bottom: 8px;
      }

      .status-card {
        padding: 14px;
        margin-bottom: 16px;
        background: #171717;
        border-radius: 9px;
      }

      #gameStatus {
        font-weight: 700;
        margin-bottom: 5px;
      }

      #engineStatus {
        color: #bdbdbd;
      }

      .control-label {
        display: block;
        margin: 12px 0;
        font-size: 13px;
        color: #d7d7d7;
      }

      .control-label select {
        display: block;
        width: 100%;
        margin-top: 6px;
        padding: 10px;
        border: 0;
        border-radius: 7px;
      }

      .button-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 9px;
        margin-top: 16px;
      }

      .button-grid button {
        padding: 10px;
        border: 0;
        border-radius: 7px;
        cursor: pointer;
        font-weight: 700;
      }

      .move-history {
        max-height: 220px;
        overflow-y: auto;
        background: #171717;
        border-radius: 8px;
        padding: 12px;
        line-height: 1.7;
        font-size: 14px;
      }

      @media (max-width: 760px) {
        body {
          padding: 16px !important;
        }

        .chess-app {
          gap: 16px;
        }

        .chess-board {
          width: min(92vw, 560px);
        }

        .game-panel {
          width: min(92vw, 560px);
        }
      }
    `;

    document.head.appendChild(style);
  }

  function getDisplaySquares() {
    const files = boardFlipped
      ? ["h", "g", "f", "e", "d", "c", "b", "a"]
      : ["a", "b", "c", "d", "e", "f", "g", "h"];

    const ranks = boardFlipped
      ? ["1", "2", "3", "4", "5", "6", "7", "8"]
      : ["8", "7", "6", "5", "4", "3", "2", "1"];

    const squares = [];

    for (const rank of ranks) {
      for (const file of files) {
        squares.push(file + rank);
      }
    }

    return squares;
  }

  function render() {
    renderBoard();
    renderStatus();
    renderHistory();
  }

  function renderBoard() {
    board.innerHTML = "";

    const squares = getDisplaySquares();
    const history = game.history({ verbose: true });
    const lastMove = history.length
      ? history[history.length - 1]
      : null;

    squares.forEach((square, index) => {
      const fileIndex = index % 8;
      const rankIndex = Math.floor(index / 8);
      const light = (fileIndex + rankIndex) % 2 === 0;

      const piece = game.get(square);

      const legalMove = legalTargets.find(
        (move) => move.to === square
      );

      const element = document.createElement("button");

      element.type = "button";
      element.className =
        `chess-square ${light ? "light" : "dark"}`;

      element.dataset.square = square;
      element.setAttribute("aria-label", square);

      if (selectedSquare === square) {
        element.classList.add("selected");
      }

      if (legalMove) {
        element.classList.add(piece ? "capture" : "legal");
      }

      if (
        lastMove &&
        (lastMove.from === square || lastMove.to === square)
      ) {
        element.classList.add("last-move");
      }

      if (piece) {
        const span = document.createElement("span");
        span.className = "piece";
        span.textContent = PIECES[piece.color][piece.type];
        element.appendChild(span);
      }

      addCoordinates(
        element,
        square,
        fileIndex,
        rankIndex
      );

      element.addEventListener("click", () => {
        handleSquareClick(square);
      });

      board.appendChild(element);
    });
  }

  function addCoordinates(
    element,
    square,
    fileIndex,
    rankIndex
  ) {
    if (fileIndex === 0) {
      const rank = document.createElement("span");
      rank.className = "coordinate rank";
      rank.textContent = square[1];
      element.appendChild(rank);
    }

    if (rankIndex === 7) {
      const file = document.createElement("span");
      file.className = "coordinate file";
      file.textContent = square[0];
      element.appendChild(file);
    }
  }

  function handleSquareClick(square) {
    if (aiThinking || game.game_over()) {
      return;
    }

    if (aiEnabled && game.turn() === "b") {
      return;
    }

    const clickedPiece = game.get(square);

    if (!selectedSquare) {
      if (
        clickedPiece &&
        clickedPiece.color === game.turn()
      ) {
        selectSquare(square);
      }

      return;
    }

    if (
      clickedPiece &&
      clickedPiece.color === game.turn()
    ) {
      selectSquare(square);
      return;
    }

    const move = game.move({
      from: selectedSquare,
      to: square,
      promotion: "q",
    });

    clearSelection();

    if (!move) {
      renderBoard();
      return;
    }

    render();

    if (
      aiEnabled &&
      !game.game_over() &&
      game.turn() === "b"
    ) {
      requestAiMove();
    }
  }

  function selectSquare(square) {
    selectedSquare = square;

    legalTargets = game.moves({
      square,
      verbose: true,
    });

    renderBoard();
  }

  function clearSelection() {
    selectedSquare = null;
    legalTargets = [];
  }

  function renderStatus() {
    const status =
      document.getElementById("gameStatus");

    if (!status) {
      return;
    }

    if (game.in_checkmate()) {
      status.textContent =
        game.turn() === "w"
          ? "Checkmate — Black wins"
          : "Checkmate — White wins";
    } else if (game.in_stalemate()) {
      status.textContent = "Draw by stalemate";
    } else if (game.in_threefold_repetition()) {
      status.textContent =
        "Draw by threefold repetition";
    } else if (game.insufficient_material()) {
      status.textContent =
        "Draw by insufficient material";
    } else if (game.in_draw()) {
      status.textContent = "Draw";
    } else {
      const player =
        game.turn() === "w" ? "White" : "Black";

      status.textContent =
        `${player} to move` +
        `${game.in_check() ? " — Check!" : ""}`;
    }
  }

  function renderHistory() {
    const historyElement =
      document.getElementById("moveHistory");

    if (!historyElement) {
      return;
    }

    const moves = game.history();

    if (!moves.length) {
      historyElement.textContent = "No moves yet";
      return;
    }

    const rows = [];

    for (let i = 0; i < moves.length; i += 2) {
      rows.push(`
        <div>
          <strong>${i / 2 + 1}.</strong>
          ${moves[i] || ""}
          ${moves[i + 1] || ""}
        </div>
      `);
    }

    historyElement.innerHTML = rows.join("");
    historyElement.scrollTop =
      historyElement.scrollHeight;
  }

  function newGame() {
    if (stockfish && pendingEngineMove) {
      stockfish.postMessage("stop");
    }

    game.reset();

    aiThinking = false;
    pendingEngineMove = false;

    clearSelection();
    render();
  }

  function undoMove() {
    if (aiThinking) {
      return;
    }

    if (aiEnabled) {
      game.undo();

      if (game.turn() === "b") {
        game.undo();
      }
    } else {
      game.undo();
    }

    clearSelection();
    render();
  }

  async function copyPgn() {
    const pgn = game.pgn() || "No moves played.";

    try {
      await navigator.clipboard.writeText(pgn);

      const button =
        document.getElementById("copyPgn");

      const original = button.textContent;

      button.textContent = "Copied!";

      setTimeout(() => {
        button.textContent = original;
      }, 1200);
    } catch {
      window.prompt("Copy this PGN:", pgn);
    }
  }

  function initializeStockfish() {
    const engineStatus =
      document.getElementById("engineStatus");

    try {
      stockfish = new Worker(STOCKFISH_PATH);

      stockfish.onmessage = (event) => {
        const line =
          typeof event.data === "string"
            ? event.data
            : String(event.data);

        if (line === "uciok") {
          stockfish.postMessage("isready");
        } else if (line === "readyok") {
          stockfishReady = true;
          configureStockfish();

          engineStatus.textContent =
            "Stockfish ready";
        } else if (line.startsWith("bestmove")) {
          handleBestMove(line);
        }
      };

      stockfish.onerror = () => {
        stockfishReady = false;

        engineStatus.textContent =
          "Stockfish files missing — using backup AI";
      };

      stockfish.postMessage("uci");
    } catch (error) {
      console.warn(
        "Stockfish could not start:",
        error
      );

      stockfishReady = false;

      engineStatus.textContent =
        "Using backup AI";
    }
  }

  function configureStockfish() {
    if (!stockfish) {
      return;
    }

    const depth = Number(
      document.getElementById("difficulty").value
    );

    const skill = Math.max(
      0,
      Math.min(20, Math.round(depth * 1.3))
    );

    stockfish.postMessage(
      `setoption name Skill Level value ${skill}`
    );
  }

  function requestAiMove() {
    aiThinking = true;
    renderStatus();

    const engineStatus =
      document.getElementById("engineStatus");

    engineStatus.textContent = stockfishReady
      ? "Stockfish is thinking..."
      : "Backup AI is thinking...";

    if (stockfishReady && stockfish) {
      pendingEngineMove = true;

      const depth = Number(
        document.getElementById("difficulty").value
      );

      stockfish.postMessage(
        `position fen ${game.fen()}`
      );

      stockfish.postMessage(
        `go depth ${depth}`
      );
    } else {
      window.setTimeout(
        makeBackupAiMove,
        350
      );
    }
  }

  function handleBestMove(line) {
    if (!pendingEngineMove) {
      return;
    }

    pendingEngineMove = false;

    const moveText = line.split(" ")[1];

    if (
      !moveText ||
      moveText === "(none)"
    ) {
      aiThinking = false;
      render();
      return;
    }

    const move = game.move({
      from: moveText.slice(0, 2),
      to: moveText.slice(2, 4),
      promotion: moveText[4] || "q",
    });

    aiThinking = false;

    if (!move) {
      console.warn(
        "Stockfish returned an invalid move:",
        moveText
      );

      makeBackupAiMove();
      return;
    }

    document.getElementById(
      "engineStatus"
    ).textContent = "Stockfish ready";

    render();
  }

  function makeBackupAiMove() {
    const moves = game.moves({
      verbose: true,
    });

    if (!moves.length) {
      aiThinking = false;
      render();
      return;
    }

    const values = {
      p: 100,
      n: 320,
      b: 330,
      r: 500,
      q: 900,
      k: 20000,
    };

    let bestScore = -Infinity;
    let bestMoves = [];

    for (const move of moves) {
      let score = Math.random() * 25;

      if (move.captured) {
        score += values[move.captured] || 0;
      }

      if (move.promotion) {
        score += values[move.promotion] || 0;
      }

      if (
        move.flags.includes("k") ||
        move.flags.includes("q")
      ) {
        score += 45;
      }

      game.move(move);

      if (game.in_checkmate()) {
        score += 100000;
      } else if (game.in_check()) {
        score += 55;
      }

      game.undo();

      if (score > bestScore) {
        bestScore = score;
        bestMoves = [move];
      } else if (score === bestScore) {
        bestMoves.push(move);
      }
    }

    const chosen =
      bestMoves[
        Math.floor(
          Math.random() * bestMoves.length
        )
      ] ||
      moves[
        Math.floor(
          Math.random() * moves.length
        )
      ];

    game.move(chosen);

    aiThinking = false;

    document.getElementById(
      "engineStatus"
    ).textContent =
      "Backup AI active — add Stockfish files for stronger play";

    render();
  }

  start();
})();
