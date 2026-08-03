(() => {
  "use strict";

  const CHESS_JS_URL =
    "https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js";

  const STOCKFISH_JS_URL =
  "https://unpkg.com/stockfish@18.0.8/bin/stockfish-18-lite-single.js";

const STOCKFISH_WASM_URL =
  "https://unpkg.com/stockfish@18.0.8/bin/stockfish-18-lite-single.wasm";

  const PIECES = {
    w: {
      k: "♔",
      q: "♕",
      r: "♖",
      b: "♗",
      n: "♘",
      p: "♙",
    },
    b: {
      k: "♚",
      q: "♛",
      r: "♜",
      b: "♝",
      n: "♞",
      p: "♟",
    },
  };

  const PIECE_NAMES = {
    p: "pawn",
    n: "knight",
    b: "bishop",
    r: "rook",
    q: "queen",
    k: "king",
  };

  let game;
  let selectedSquare = null;
  let legalMoves = [];
  let boardFlipped = false;

  let aiEnabled = true;
  let aiThinking = false;

  let stockfish = null;
  let stockfishReady = false;
  let pendingEngineMove = false;

  const board = document.getElementById("board");

  if (!board) {
    document.body.innerHTML =
      '<p style="padding:20px;font-family:Arial">The chessboard element is missing from index.html.</p>';
    return;
  }

  function loadExternalScript(source) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");

      script.src = source;
      script.onload = resolve;
      script.onerror = reject;

      document.head.appendChild(script);
    });
  }

  async function initializeGame() {
    try {
      if (typeof window.Chess === "undefined") {
        await loadExternalScript(CHESS_JS_URL);
      }

      game = new window.Chess();

      createGameInterface();
      initializeStockfish();
      renderEverything();
    } catch (error) {
      console.error(error);

      board.innerHTML = `
        <div style="padding:20px">
          The chess rules library could not load.
          Check your internet connection and refresh the page.
        </div>
      `;
    }
  }

  function createGameInterface() {
    const wrapper = document.createElement("div");
    wrapper.className = "chess-app";

    const parent = board.parentElement;

    parent.insertBefore(wrapper, board);
    wrapper.appendChild(board);

    board.className = "chess-board";

    const panel = document.createElement("aside");
    panel.className = "game-panel";

    panel.innerHTML = `
      <h2>Game Controls</h2>

      <div class="status-card">
        <div id="gameStatus">White to move</div>
        <small id="engineStatus">Loading Stockfish...</small>
      </div>

      <label class="control-label">
        Game mode

        <select id="gameMode">
          <option value="computer">
            Play against computer
          </option>

          <option value="local">
            Two players
          </option>
        </select>
      </label>

      <label class="control-label">
        Computer difficulty

        <select id="difficulty">
          <option value="2">
            Beginner
          </option>

          <option value="5" selected>
            Easy
          </option>

          <option value="8">
            Medium
          </option>

          <option value="11">
            Hard
          </option>

          <option value="14">
            Expert
          </option>

          <option value="17">
            Master
          </option>
        </select>
      </label>

      <div class="button-grid">
        <button id="newGameButton">
          New Game
        </button>

        <button id="undoButton">
          Undo
        </button>

        <button id="flipButton">
          Flip Board
        </button>

        <button id="copyPgnButton">
          Copy PGN
        </button>
      </div>

      <h3>Move History</h3>

      <div
        id="moveHistory"
        class="move-history"
      >
        No moves yet
      </div>
    `;

    wrapper.appendChild(panel);

    document
      .getElementById("gameMode")
      .addEventListener("change", handleGameModeChange);

    document
      .getElementById("difficulty")
      .addEventListener("change", configureStockfish);

    document
      .getElementById("newGameButton")
      .addEventListener("click", startNewGame);

    document
      .getElementById("undoButton")
      .addEventListener("click", undoMove);

    document
      .getElementById("flipButton")
      .addEventListener("click", flipBoard);

    document
      .getElementById("copyPgnButton")
      .addEventListener("click", copyPgn);
  }

  function handleGameModeChange(event) {
    aiEnabled = event.target.value === "computer";

    startNewGame();
  }

  function getDisplayedSquares() {
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

  function renderEverything() {
    renderBoard();
    renderGameStatus();
    renderMoveHistory();
  }

  function renderBoard() {
    board.innerHTML = "";

    const displayedSquares = getDisplayedSquares();
    const history = game.history({
      verbose: true,
    });

    const lastMove =
      history.length > 0
        ? history[history.length - 1]
        : null;

    displayedSquares.forEach((square, index) => {
      const visualFile = index % 8;
      const visualRank = Math.floor(index / 8);

      const isLightSquare =
        (visualFile + visualRank) % 2 === 0;

      const piece = game.get(square);

      const legalMove = legalMoves.find(
        (move) => move.to === square
      );

      const squareElement =
        document.createElement("button");

      squareElement.type = "button";

      squareElement.className =
        `chess-square ${
          isLightSquare ? "light" : "dark"
        }`;

      squareElement.dataset.square = square;

      squareElement.setAttribute(
        "aria-label",
        createSquareDescription(square, piece)
      );

      if (selectedSquare === square) {
        squareElement.classList.add("selected");
      }

      if (legalMove) {
        squareElement.classList.add(
          piece ? "capture" : "legal"
        );
      }

      if (
        lastMove &&
        (
          lastMove.from === square ||
          lastMove.to === square
        )
      ) {
        squareElement.classList.add("last-move");
      }

      if (piece) {
        const pieceElement =
          document.createElement("span");

        pieceElement.className = "piece";
        pieceElement.textContent =
          PIECES[piece.color][piece.type];

        squareElement.appendChild(pieceElement);
      }

      addBoardCoordinates(
        squareElement,
        square,
        visualFile,
        visualRank
      );

      squareElement.addEventListener(
        "click",
        () => handleSquareClick(square)
      );

      board.appendChild(squareElement);
    });
  }

  function createSquareDescription(square, piece) {
    if (!piece) {
      return `${square}, empty square`;
    }

    const color =
      piece.color === "w"
        ? "White"
        : "Black";

    return `${square}, ${color} ${
      PIECE_NAMES[piece.type]
    }`;
  }

  function addBoardCoordinates(
    element,
    square,
    visualFile,
    visualRank
  ) {
    if (visualFile === 0) {
      const rankLabel =
        document.createElement("span");

      rankLabel.className =
        "coordinate rank";

      rankLabel.textContent = square[1];

      element.appendChild(rankLabel);
    }

    if (visualRank === 7) {
      const fileLabel =
        document.createElement("span");

      fileLabel.className =
        "coordinate file";

      fileLabel.textContent = square[0];

      element.appendChild(fileLabel);
    }
  }

  function handleSquareClick(square) {
    if (aiThinking || game.game_over()) {
      return;
    }

    if (
      aiEnabled &&
      game.turn() === "b"
    ) {
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

    attemptPlayerMove(
      selectedSquare,
      square
    );
  }

  function selectSquare(square) {
    selectedSquare = square;

    legalMoves = game.moves({
      square,
      verbose: true,
    });

    renderBoard();
  }

  function clearSelection() {
    selectedSquare = null;
    legalMoves = [];
  }

  function attemptPlayerMove(from, to) {
    const possibleMoves = game.moves({
      square: from,
      verbose: true,
    });

    const requestedMove = possibleMoves.find(
      (move) => move.to === to
    );

    if (!requestedMove) {
      clearSelection();
      renderBoard();
      return;
    }

    let promotionPiece = "q";

    if (
      requestedMove.flags.includes("p")
    ) {
      promotionPiece =
        choosePromotionPiece();
    }

    const move = game.move({
      from,
      to,
      promotion: promotionPiece,
    });

    clearSelection();

    if (!move) {
      renderBoard();
      return;
    }

    renderEverything();

    if (
      aiEnabled &&
      !game.game_over() &&
      game.turn() === "b"
    ) {
      requestComputerMove();
    }
  }

  function choosePromotionPiece() {
    const answer = window.prompt(
      "Promote pawn to: q, r, b or n",
      "q"
    );

    const value =
      String(answer || "q")
        .trim()
        .toLowerCase();

    if (
      ["q", "r", "b", "n"].includes(value)
    ) {
      return value;
    }

    return "q";
  }

  function renderGameStatus() {
    const statusElement =
      document.getElementById("gameStatus");

    if (!statusElement) {
      return;
    }

    if (game.in_checkmate()) {
      const winner =
        game.turn() === "w"
          ? "Black"
          : "White";

      statusElement.textContent =
        `Checkmate — ${winner} wins`;

      return;
    }

    if (game.in_stalemate()) {
      statusElement.textContent =
        "Draw by stalemate";

      return;
    }

    if (game.in_threefold_repetition()) {
      statusElement.textContent =
        "Draw by threefold repetition";

      return;
    }

    if (game.insufficient_material()) {
      statusElement.textContent =
        "Draw by insufficient material";

      return;
    }

    if (game.in_draw()) {
      statusElement.textContent = "Draw";
      return;
    }

    const player =
      game.turn() === "w"
        ? "White"
        : "Black";

    const checkMessage =
      game.in_check()
        ? " — Check!"
        : "";

    const thinkingMessage =
      aiThinking
        ? " — Computer thinking..."
        : "";

    statusElement.textContent =
      `${player} to move${checkMessage}${thinkingMessage}`;
  }

  function renderMoveHistory() {
    const historyElement =
      document.getElementById("moveHistory");

    if (!historyElement) {
      return;
    }

    const moves = game.history();

    if (moves.length === 0) {
      historyElement.textContent =
        "No moves yet";

      return;
    }

    const rows = [];

    for (
      let index = 0;
      index < moves.length;
      index += 2
    ) {
      const whiteMove =
        moves[index] || "";

      const blackMove =
        moves[index + 1] || "";

      rows.push(`
        <div>
          <strong>
            ${index / 2 + 1}.
          </strong>

          <span>
            ${escapeHtml(whiteMove)}
          </span>

          <span>
            ${escapeHtml(blackMove)}
          </span>
        </div>
      `);
    }

    historyElement.innerHTML =
      rows.join("");

    historyElement.scrollTop =
      historyElement.scrollHeight;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function startNewGame() {
    stopStockfishSearch();

    game.reset();

    aiThinking = false;
    pendingEngineMove = false;

    clearSelection();
    renderEverything();

    updateEngineStatus();
  }

  function undoMove() {
    if (aiThinking) {
      return;
    }

    if (game.history().length === 0) {
      return;
    }

    if (aiEnabled) {
      game.undo();

      if (
        game.history().length > 0 &&
        game.turn() === "b"
      ) {
        game.undo();
      }
    } else {
      game.undo();
    }

    clearSelection();
    renderEverything();
  }

  function flipBoard() {
    boardFlipped = !boardFlipped;

    renderBoard();
  }

  async function copyPgn() {
    const pgn =
      game.pgn() || "No moves played.";

    const button =
      document.getElementById(
        "copyPgnButton"
      );

    try {
      await navigator.clipboard.writeText(
        pgn
      );

      const previousText =
        button.textContent;

      button.textContent = "Copied!";

      window.setTimeout(() => {
        button.textContent =
          previousText;
      }, 1200);
    } catch (error) {
      window.prompt(
        "Copy the PGN below:",
        pgn
      );
    }
  }

  function initializeStockfish() {
    const engineStatus =
      document.getElementById(
        "engineStatus"
      );

    try {
      stockfish =
        new Worker(STOCKFISH_FILE);

      stockfish.onmessage =
        handleStockfishMessage;

      stockfish.onerror = (error) => {
        console.warn(
          "Stockfish could not load:",
          error
        );

        stockfishReady = false;

        engineStatus.textContent =
          "Stockfish unavailable — backup AI active";
      };

      stockfish.postMessage("uci");
    } catch (error) {
      console.warn(
        "Stockfish worker failed:",
        error
      );

      stockfishReady = false;

      engineStatus.textContent =
        "Backup AI active";
    }
  }

  function handleStockfishMessage(event) {
    const response =
      typeof event.data === "string"
        ? event.data
        : String(event.data);

    if (response === "uciok") {
      stockfish.postMessage("isready");
      return;
    }

    if (response === "readyok") {
      stockfishReady = true;

      configureStockfish();
      updateEngineStatus();

      return;
    }

    if (
      response.startsWith("bestmove")
    ) {
      handleStockfishBestMove(response);
    }
  }

  function configureStockfish() {
    if (
      !stockfish ||
      !stockfishReady
    ) {
      return;
    }

    const selectedDepth =
      Number(
        document.getElementById(
          "difficulty"
        ).value
      );

    const skillLevel = Math.max(
      0,
      Math.min(
        20,
        Math.round(selectedDepth * 1.15)
      )
    );

    stockfish.postMessage(
      `setoption name Skill Level value ${skillLevel}`
    );

    stockfish.postMessage(
      "setoption name Hash value 32"
    );

    stockfish.postMessage("isready");
  }

  function updateEngineStatus() {
    const engineStatus =
      document.getElementById(
        "engineStatus"
      );

    if (!engineStatus) {
      return;
    }

    if (stockfishReady) {
      engineStatus.textContent =
        "Stockfish 18 ready";
    } else {
      engineStatus.textContent =
        "Backup AI active";
    }
  }

  function requestComputerMove() {
    aiThinking = true;

    renderGameStatus();

    const engineStatus =
      document.getElementById(
        "engineStatus"
      );

    if (
      stockfishReady &&
      stockfish
    ) {
      pendingEngineMove = true;

      const depth =
        Number(
          document.getElementById(
            "difficulty"
          ).value
        );

      engineStatus.textContent =
        "Stockfish is thinking...";

      stockfish.postMessage(
        `position fen ${game.fen()}`
      );

      stockfish.postMessage(
        `go depth ${depth}`
      );

      return;
    }

    engineStatus.textContent =
      "Backup AI is thinking...";

    window.setTimeout(
      makeBackupComputerMove,
      350
    );
  }

  function stopStockfishSearch() {
    if (
      stockfish &&
      pendingEngineMove
    ) {
      stockfish.postMessage("stop");
    }

    pendingEngineMove = false;
  }

  function handleStockfishBestMove(
    response
  ) {
    if (!pendingEngineMove) {
      return;
    }

    pendingEngineMove = false;

    const moveText =
      response.split(" ")[1];

    if (
      !moveText ||
      moveText === "(none)"
    ) {
      aiThinking = false;
      renderEverything();
      return;
    }

    const move = game.move({
      from: moveText.slice(0, 2),
      to: moveText.slice(2, 4),
      promotion:
        moveText.slice(4, 5) || "q",
    });

    aiThinking = false;

    if (!move) {
      console.warn(
        "Stockfish returned an invalid move:",
        moveText
      );

      makeBackupComputerMove();
      return;
    }

    updateEngineStatus();
    renderEverything();
  }

  function makeBackupComputerMove() {
    const possibleMoves = game.moves({
      verbose: true,
    });

    if (possibleMoves.length === 0) {
      aiThinking = false;
      renderEverything();
      return;
    }

    const pieceValues = {
      p: 100,
      n: 320,
      b: 330,
      r: 500,
      q: 900,
      k: 20000,
    };

    let highestScore = -Infinity;
    let bestMoves = [];

    for (
      const candidateMove
      of possibleMoves
    ) {
      let score =
        Math.random() * 20;

      if (candidateMove.captured) {
        score +=
          pieceValues[
            candidateMove.captured
          ] || 0;
      }

      if (candidateMove.promotion) {
        score +=
          pieceValues[
            candidateMove.promotion
          ] || 0;
      }

      if (
        candidateMove.flags.includes("k") ||
        candidateMove.flags.includes("q")
      ) {
        score += 50;
      }

      game.move(candidateMove);

      if (game.in_checkmate()) {
        score += 100000;
      } else if (game.in_check()) {
        score += 70;
      }

      const movedPiece =
        game.get(candidateMove.to);

      if (movedPiece) {
        score +=
          evaluateSquarePosition(
            candidateMove.to,
            movedPiece.type
          );
      }

      game.undo();

      if (score > highestScore) {
        highestScore = score;
        bestMoves = [candidateMove];
      } else if (
        score === highestScore
      ) {
        bestMoves.push(candidateMove);
      }
    }

    const selectedMove =
      bestMoves[
        Math.floor(
          Math.random() *
          bestMoves.length
        )
      ];

    game.move(selectedMove);

    aiThinking = false;

    document.getElementById(
      "engineStatus"
    ).textContent =
      "Backup AI active — add Stockfish files for stronger play";

    renderEverything();
  }

  function evaluateSquarePosition(
    square,
    pieceType
  ) {
    const centerSquares = [
      "d4",
      "e4",
      "d5",
      "e5",
    ];

    const nearCenterSquares = [
      "c3",
      "d3",
      "e3",
      "f3",
      "c4",
      "f4",
      "c5",
      "f5",
      "c6",
      "d6",
      "e6",
      "f6",
    ];

    if (
      centerSquares.includes(square)
    ) {
      return pieceType === "k"
        ? -10
        : 25;
    }

    if (
      nearCenterSquares.includes(square)
    ) {
      return pieceType === "k"
        ? -5
        : 12;
    }

    return 0;
  }

  initializeGame();
})();
