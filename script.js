/*
  Tempo usado para descobrir
  a frequência da taça.
*/

const DETECTION_TIME = 5000;

/*
  Tempo necessário de ressonância
  para simular a quebra.

  2500 ms = 2,5 segundos.
*/

const BREAK_TIME = 2500;

/*
  A voz pode variar até 8 Hz
  para cada lado da frequência
  da taça.

  Exemplo:

  Taça = 850 Hz

  Aceita:
  842 Hz → 858 Hz
*/

const FREQUENCY_TOLERANCE = 8;

/*
  Limite usado para considerar
  que existe som.
*/

const SILENCE = 0.0025;

/*
  Frequência inicial.
*/

let TARGET_FREQ = 850;

/* =========================================================
   ÁUDIO
========================================================= */

let audioContext = null;

let analyser = null;

let microphone = null;

let stream = null;

let freqData = null;

let timeData = null;

let micActive = false;

/* =========================================================
   ESTADO
========================================================= */

let currentMode = "glass";

let scanRunning = false;

let scanStart = 0;

let scanTimer = null;

/*
  Melhor frequência encontrada
  durante a medição da taça.
*/

let bestFreq = 0;

let bestMagnitude = 0;

/*
  Frequência atual da voz.
*/

let voiceFreq = 0;

let waveformFrequency = 0;

/*
  Estado da quebra.
*/

let voiceCracked = false;

/*
  Início da ressonância.
*/

let resonanceStart = 0;

/*
  Tempo atual de ressonância.
*/

let resonanceTime = 0;

/*
  Picos encontrados.
*/

let peaks = [];

/* =========================================================
   ELEMENTOS
========================================================= */

const tabs = document.querySelectorAll(".tab");

const contents = document.querySelectorAll(".content");

const glassHz = document.getElementById("glassHz");

const glassLiveHz = document.getElementById("glassLiveHz");

const glassLevel = document.getElementById("glassLevel");

const glassStatus = document.getElementById("glassStatus");

const timer = document.getElementById("timer");

const savedInfo = document.getElementById("savedInfo");

const micBtn = document.getElementById("micBtn");

const newScan = document.getElementById("newScan");

const voiceHz = document.getElementById("voiceHz");

const voiceLiveHz = document.getElementById("voiceLiveHz");

const voiceLevel = document.getElementById("voiceLevel");

const voiceSignal = document.getElementById("voiceSignal");

const voiceStatus = document.getElementById("voiceStatus");

const voiceMic = document.getElementById("voiceMic");

const voiceReset = document.getElementById("voiceReset");

const targetDisplay = document.getElementById("targetDisplay");

const targetInput = document.getElementById("targetInput");

const applyTarget = document.getElementById("applyTarget");

const targetLiveHz = document.getElementById("targetLiveHz");

const differenceHz = document.getElementById("differenceHz");

const energy = document.getElementById("energy");

const energyText = document.getElementById("energyText");

const crackMessage = document.getElementById("crackMessage");

const peaksBox = document.getElementById("peaks");

const resonanceTimer = document.getElementById("resonanceTimer");

const breakProgress = document.getElementById("breakProgress");

const glassCanvas = document.getElementById("glassCanvas");

const glassCtx = glassCanvas.getContext("2d");

const voiceCanvas = document.getElementById("voiceCanvas");

const voiceCtx = voiceCanvas.getContext("2d");

/* =========================================================
   TROCA DE ABA
========================================================= */

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    currentMode = tab.dataset.tab;

    tabs.forEach((t) => {
      t.classList.toggle("active", t === tab);
    });

    contents.forEach((content) => {
      content.classList.toggle("active", content.id === currentMode);
    });
  });
});

/* =========================================================
   MICROFONE
========================================================= */

function showMicrophoneError(message) {
  glassStatus.textContent = `❌ ${message}`;
  voiceStatus.textContent = `❌ ${message}`;
}

function canUseMicrophone() {
  const isLocalHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "0.0.0.0";

  if (!window.isSecureContext && !isLocalHost) {
    showMicrophoneError(
      "Abra a página via http://localhost ou HTTPS para usar o microfone.",
    );

    return false;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showMicrophoneError("Este navegador não suporta acesso ao microfone.");

    return false;
  }

  const AC = window.AudioContext || window.webkitAudioContext;

  if (!AC) {
    showMicrophoneError("Seu navegador não suporta AudioContext.");

    return false;
  }

  return true;
}

async function startMicrophone() {
  /*
    Se o microfone já estiver ativo,
    o botão desliga.
  */

  if (micActive) {
    stopMicrophone();

    return;
  }

  if (!canUseMicrophone()) {
    return;
  }

  try {
    /*
      Solicita o microfone.

      Os processamentos automáticos
      são desligados para tentar preservar
      melhor a frequência original.
    */

    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    stream = mediaStream;

    const AC = window.AudioContext || window.webkitAudioContext;

    audioContext = new AC();

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    analyser = audioContext.createAnalyser();

    /*
      FFT maior = maior resolução
      de frequência.
    */

    analyser.fftSize = 16384;

    analyser.smoothingTimeConstant = 0.2;

    freqData = new Uint8Array(analyser.frequencyBinCount);

    timeData = new Float32Array(analyser.fftSize);

    microphone = audioContext.createMediaStreamSource(stream);

    microphone.connect(analyser);

    micActive = true;

    updateButtons();

    /*
      Começa automaticamente
      a medição da taça.
    */

    if (currentMode === "glass") {
      startScan();
    }

    analyse();
  } catch (error) {
    console.error(error);

    if (error && error.name === "NotAllowedError") {
      showMicrophoneError("Permita o acesso ao microfone no navegador.");
    } else if (error && error.name === "NotFoundError") {
      showMicrophoneError("Nenhum microfone foi encontrado.");
    } else {
      showMicrophoneError("Não foi possível acessar o microfone.");
    }

    stopMicrophone();
  }
}

/* =========================================================
   DESLIGAR MICROFONE
========================================================= */

function stopMicrophone() {
  if (stream) {
    stream.getTracks().forEach((track) => {
      track.stop();
    });
  }

  if (audioContext) {
    try {
      if (audioContext.state !== "closed") {
        audioContext.close();
      }
    } catch (error) {
      console.warn("AudioContext já estava fechado.", error);
    }
  }

  stream = null;

  audioContext = null;

  analyser = null;

  microphone = null;

  freqData = null;

  timeData = null;

  micActive = false;

  stopScan();

  updateButtons();

  glassLevel.style.width = "0%";

  voiceLevel.style.width = "0%";

  voiceSignal.textContent = "0%";

  voiceFreq = 0;

  waveformFrequency = 0;
}

/* =========================================================
   BOTÕES
========================================================= */

function updateButtons() {
  const text = micActive ? "🎤 Desativar microfone" : "🎤 Ativar microfone";

  micBtn.textContent = text;

  voiceMic.textContent = text;
}

/* =========================================================
   INICIAR MEDIÇÃO DA TAÇA
========================================================= */

function startScan() {
  if (!micActive) return;

  scanRunning = true;

  scanStart = performance.now();

  bestFreq = 0;

  bestMagnitude = 0;

  peaks = [];

  /*
    Durante uma nova medição,
    apagamos apenas a leitura
    instantânea.

    A frequência definitiva
    anterior não precisa ser apagada
    até existir uma nova.
  */

  glassLiveHz.textContent = "---";

  glassHz.classList.remove("found");

  savedInfo.textContent = "";

  glassStatus.textContent = "🎙️ Toque na borda da taça...";

  timer.textContent = "5.0";

  renderPeaks();

  clearInterval(scanTimer);

  scanTimer = setInterval(updateTimer, 50);
}

/* =========================================================
   PARAR MEDIÇÃO
========================================================= */

function stopScan() {
  scanRunning = false;

  if (scanTimer) {
    clearInterval(scanTimer);
  }

  scanTimer = null;
}

/* =========================================================
   CONTADOR DA TAÇA
========================================================= */

function updateTimer() {
  if (!scanRunning) return;

  const elapsed = performance.now() - scanStart;

  const remaining = Math.max(0, DETECTION_TIME - elapsed);

  timer.textContent = (remaining / 1000).toFixed(1);

  if (remaining <= 0) {
    finishScan();
  }
}

/* =========================================================
   FINALIZAR MEDIÇÃO
========================================================= */

function finishScan() {
  if (!scanRunning) return;

  scanRunning = false;

  clearInterval(scanTimer);

  scanTimer = null;

  timer.textContent = "0.0";

  /*
    Encontrou uma frequência.
  */

  if (bestFreq > 0) {
    const finalFreq = Math.round(bestFreq);

    /*
      Salva no navegador.
    */

    localStorage.setItem("tacaFrequencia", finalFreq);

    /*
      Esta é a frequência definitiva
      da taça.

      Ela NÃO será alterada pela voz.
    */

    TARGET_FREQ = Math.min(2000, finalFreq);

    targetDisplay.textContent = TARGET_FREQ;

    targetInput.value = TARGET_FREQ;

    targetLiveHz.textContent = TARGET_FREQ + " Hz";

    /*
      Frequência definitiva.
    */

    glassHz.textContent = finalFreq;

    glassHz.classList.add("found");

    savedInfo.textContent = "✓ Frequência da taça salva: " + finalFreq + " Hz";

    glassStatus.textContent =
      "✅ Taça detectada! " + finalFreq + " Hz foi definido como alvo.";
  } else {
    glassStatus.textContent = "⚠️ Nenhuma frequência detectada.";
  }
}

/* =========================================================
   ANÁLISE PRINCIPAL
========================================================= */

function analyse() {
  if (!micActive || !analyser || !timeData) {
    return;
  }

  analyser.getFloatTimeDomainData(timeData);

  let sum = 0;

  for (let i = 0; i < timeData.length; i++) {
    sum += timeData[i] * timeData[i];
  }

  const rms = Math.sqrt(sum / timeData.length);

  const level =
    rms < SILENCE ? 0 : Math.min(100, Math.round(rms * 1500));

  if (currentMode === "glass") {
    glassLevel.style.width = level + "%";

    processGlass(rms);
  } else {
    voiceLevel.style.width = level + "%";

    voiceSignal.textContent = Math.round(level) + "%";

    processVoice(rms);
  }

  requestAnimationFrame(analyse);
}

/* =========================================================
   FREQUÊNCIA DA TAÇA
========================================================= */

function processGlass(rms) {
  if (!scanRunning) return;

  if (rms < SILENCE) return;

  analyser.getByteFrequencyData(freqData);

  const binWidth = audioContext.sampleRate / analyser.fftSize;

  const minBin = Math.floor(100 / binWidth);

  const maxBin = Math.min(freqData.length - 2, Math.floor(4000 / binWidth));

  let max = 0;

  let maxIndex = -1;

  /*
    Procura a frequência
    de maior magnitude.
  */

  for (let i = minBin; i < maxBin; i++) {
    if (freqData[i] > max) {
      max = freqData[i];

      maxIndex = i;
    }
  }

  if (maxIndex < 1) {
    return;
  }

  /*
    Interpolação parabólica
    para melhorar a precisão.
  */

  const y1 = freqData[maxIndex - 1];

  const y2 = freqData[maxIndex];

  const y3 = freqData[maxIndex + 1];

  const a = (y1 + y3 - 2 * y2) / 2;

  const b = (y3 - y1) / 2;

  let offset = 0;

  if (a !== 0) {
    offset = -b / (2 * a);
  }

  const frequency = (maxIndex + offset) * binWidth;

  if (frequency < 100 || frequency > 4000) {
    return;
  }

  /*
    SOMENTE a leitura atual
    aparece aqui.

    NÃO alteramos glassHz.
  */

  const shown = Math.round(frequency);

  glassLiveHz.textContent = shown + " Hz";

  /*
    Guarda a frequência
    mais forte encontrada.
  */

  if (max > bestMagnitude) {
    bestMagnitude = max;

    bestFreq = frequency;
  }

  /*
    Guarda os picos.
  */

  const existing = peaks.find((p) => Math.abs(p.freq - frequency) < 8);

  if (existing) {
    if (max > existing.mag) {
      existing.mag = max;
    }
  } else {
    peaks.push({
      freq: frequency,

      mag: max,
    });

    if (peaks.length > 12) {
      peaks.shift();
    }
  }

  renderPeaks();
}

/* =========================================================
   PICOS
========================================================= */

function renderPeaks() {
  if (!peaks.length) {
    peaksBox.innerHTML = "Nenhum pico detectado.";

    return;
  }

  const sorted = [...peaks].sort((a, b) => b.mag - a.mag);

  peaksBox.innerHTML = sorted
    .map(
      (p) => `

      <div style="
        display:flex;
        justify-content:space-between;
        padding:10px;
        margin-bottom:6px;
        background:#101a28;
        border-radius:10px;
        color:#ffb86b">

        <span>
          ${Math.round(p.freq)} Hz
        </span>

        <span>
          ${Math.round((p.mag / 255) * 100)}%
        </span>

      </div>

    `,
    )
    .join("");
}

/* =========================================================
   VOZ
========================================================= */

function processVoice(rms) {
  if (voiceCracked) return;

  if (rms < SILENCE) {
    voiceFreq = 0;

    voiceHz.textContent = "---";

    voiceLiveHz.textContent = "---";

    differenceHz.textContent = "---";

    voiceStatus.textContent = "🎙️ Aguardando sua voz...";

    voiceLevel.style.width = "0%";

    energy.style.width = "0%";

    energyText.textContent = "0%";

    voiceSignal.textContent = "0%";

    /*
      Silêncio interrompe
      a ressonância.
    */

    resonanceStart = 0;

    resonanceTime = 0;

    if (resonanceTimer) {
      resonanceTimer.textContent = "0,0 s";
    }

    if (breakProgress) {
      breakProgress.style.width = "0%";
    }

    return;
  }

  let pitch = autoCorrelate(timeData, audioContext.sampleRate);

  if (pitch <= 0) {
    pitch = estimatePitchFromZeroCrossing(timeData, audioContext.sampleRate);
  }

  if (pitch > 0) {
    /*
      Suaviza a leitura.
    */

    if (voiceFreq === 0) {
      voiceFreq = pitch;
    } else {
      voiceFreq = voiceFreq * 0.75 + pitch * 0.25;
    }

    updateVoice(voiceFreq);
  } else {
    voiceFreq = 0;
    voiceHz.textContent = "---";
    voiceLiveHz.textContent = "---";
    differenceHz.textContent = "---";
    voiceStatus.textContent =
      "🔊 Som recebido, mas não consegui identificar o tom. Tente sustentar uma vogal.";
    energy.style.width = "0%";
    energyText.textContent = "0%";

    resonanceStart = 0;
    resonanceTime = 0;

    if (resonanceTimer) {
      resonanceTimer.textContent = "0,0 s";
    }

    if (breakProgress) {
      breakProgress.style.width = "0%";
    }
  }
}

/* =========================================================
   DETECÇÃO POR CRUZAMENTO DE ZERO
========================================================= */

function estimatePitchFromZeroCrossing(buffer, sampleRate) {
  let zeroCrossings = 0;

  for (let i = 1; i < buffer.length; i++) {
    const prev = buffer[i - 1];
    const curr = buffer[i];

    if ((prev >= 0 && curr < 0) || (prev < 0 && curr >= 0)) {
      zeroCrossings++;
    }
  }

  if (zeroCrossings <= 0 || buffer.length <= 1) {
    return -1;
  }

  const durationSeconds = (buffer.length - 1) / sampleRate;

  if (durationSeconds <= 0) {
    return -1;
  }

  const frequency = (zeroCrossings / 2) / durationSeconds;

  if (frequency < 60 || frequency > 1200) {
    return -1;
  }

  return frequency;
}

/* =========================================================
   AUTOCORRELAÇÃO
========================================================= */

function autoCorrelate(buffer, sampleRate) {
  const downsampleFactor = 4;
  const effectiveSampleRate = sampleRate / downsampleFactor;
  const sampleCount = Math.min(2048, Math.floor(buffer.length / downsampleFactor));

  if (sampleCount < 2) {
    return -1;
  }

  const samples = new Float32Array(sampleCount);
  let mean = 0;

  for (let i = 0; i < sampleCount; i++) {
    samples[i] = buffer[i * downsampleFactor];
    mean += samples[i];
  }

  mean /= sampleCount;

  for (let i = 0; i < sampleCount; i++) {
    samples[i] -= mean;
  }

  const minOffset = Math.max(1, Math.floor(effectiveSampleRate / 1200) - 1);
  const maxOffset = Math.min(
    Math.floor(effectiveSampleRate / 60),
    Math.floor(sampleCount / 2),
  );

  const correlations = [];

  for (let offset = minOffset; offset <= maxOffset; offset++) {
    let crossCorrelation = 0;
    let firstEnergy = 0;
    let secondEnergy = 0;

    for (let i = 0; i < sampleCount - offset; i += 2) {
      const first = samples[i];
      const second = samples[i + offset];

      crossCorrelation += first * second;
      firstEnergy += first * first;
      secondEnergy += second * second;
    }

    correlations.push(
      crossCorrelation / Math.sqrt(firstEnergy * secondEnergy),
    );
  }

  for (let i = 0; i < correlations.length; i++) {
    const previous = correlations[i - 1] ?? -Infinity;
    const next = correlations[i + 1] ?? -Infinity;

    if (
      i > 0 &&
      correlations[i] >= 0.55 &&
      correlations[i] >= previous &&
      correlations[i] >= next
    ) {
      const denominator = previous - 2 * correlations[i] + next;
      const adjustment =
        denominator === 0 ? 0 : (0.5 * (previous - next)) / denominator;

      const frequency =
        effectiveSampleRate / (minOffset + i + adjustment);

      return frequency >= 60 && frequency <= 1210
        ? Math.min(frequency, 1200)
        : -1;
    }
  }

  return -1;
}

/* =========================================================
   ATUALIZAÇÃO DA VOZ
========================================================= */

function updateVoice(freq) {
  if (voiceCracked) return;

  const rounded = Math.round(freq);

  /*
    FREQUÊNCIA DA VOZ

    Esta muda constantemente.
  */

  voiceHz.textContent = rounded;

  voiceLiveHz.textContent = rounded + " Hz";

  /*
    FREQUÊNCIA DA TAÇA

    Esta permanece fixa.
  */

  targetLiveHz.textContent = Math.round(TARGET_FREQ) + " Hz";

  /*
    Diferença entre voz e taça.
  */

  const difference = Math.abs(freq - TARGET_FREQ);

  differenceHz.textContent = Math.round(difference) + " Hz";

  /*
    Calcula a energia
    de ressonância.

    100 Hz de diferença = 0%
    0 Hz de diferença = 100%
  */

  let resonance = 1 - difference / 100;

  resonance = Math.max(0, Math.min(1, resonance));

  const percent = Math.round(resonance * 100);

  energy.style.width = percent + "%";

  energyText.textContent = percent + "%";

  /* =====================================================
     DENTRO DA TOLERÂNCIA
  ===================================================== */

  if (difference <= FREQUENCY_TOLERANCE) {
    /*
      Começa o cronômetro
      quando entra na faixa.
    */

    if (resonanceStart === 0) {
      resonanceStart = performance.now();
    }

    /*
      Calcula o tempo contínuo.
    */

    resonanceTime = performance.now() - resonanceStart;

    const seconds = resonanceTime / 1000;

    if (resonanceTimer) {
      resonanceTimer.textContent = seconds.toFixed(1) + " s";
    }

    /*
      Barra de progresso.
    */

    const progress = Math.min(100, (resonanceTime / BREAK_TIME) * 100);

    if (breakProgress) {
      breakProgress.style.width = progress + "%";
    }

    /*
      Mensagens.
    */

    if (difference <= 3) {
      voiceStatus.textContent =
        "🔥 Frequência excelente! " + "Mantenha o som...";
    } else {
      voiceStatus.textContent =
        "🟢 Ressonância detectada! " + "Mantenha a frequência...";
    }

    /*
      Tempo atingido.
    */

    if (resonanceTime >= BREAK_TIME) {
      breakGlass();
    }
  } else {
    /*
      Saiu da faixa.

      A ressonância precisa
      começar novamente.
    */

    resonanceStart = 0;

    resonanceTime = 0;

    if (resonanceTimer) {
      resonanceTimer.textContent = "0,0 s";
    }

    if (breakProgress) {
      breakProgress.style.width = "0%";
    }

    /*
      Orientação para o usuário.
    */

    if (freq < TARGET_FREQ) {
      voiceStatus.textContent =
        "⬆️ Aumente a frequência — alvo: " + Math.round(TARGET_FREQ) + " Hz";
    } else {
      voiceStatus.textContent =
        "⬇️ Diminua a frequência — alvo: " + Math.round(TARGET_FREQ) + " Hz";
    }
  }
}

/* =========================================================
   QUEBRA DA TAÇA
========================================================= */

function breakGlass() {
  if (voiceCracked) return;

  voiceCracked = true;

  /*
    Fixa o cronômetro
    exatamente em 2,5 segundos.
  */

  resonanceTime = BREAK_TIME;

  if (resonanceTimer) {
    resonanceTimer.textContent = (BREAK_TIME / 1000).toFixed(1) + " s";
  }

  if (breakProgress) {
    breakProgress.style.width = "100%";
  }

  /*
    Mensagem.
  */

  crackMessage.textContent = "💥🍷 TAÇA QUEBRADA! 🍷💥";

  crackMessage.style.color = "#ff4d6d";

  voiceStatus.textContent =
    "💥 Ressonância atingida! " +
    "A frequência permaneceu próxima " +
    "da taça por 2,5 segundos.";

  /*
    Energia máxima.
  */

  energy.style.width = "100%";

  energyText.textContent = "100%";

  /*
    IMPORTANTE:

    TARGET_FREQ NÃO é alterado.

    Portanto, se a taça era:

    850 Hz

    continuará:

    850 Hz

    mesmo depois da quebra.
  */
}

/* =========================================================
   BOTÕES
========================================================= */

micBtn.addEventListener("click", startMicrophone);

voiceMic.addEventListener("click", startMicrophone);

/* =========================================================
   NOVA MEDIÇÃO
========================================================= */

newScan.addEventListener("click", () => {
  if (!micActive) {
    glassStatus.textContent = "🎤 Ative o microfone primeiro.";

    return;
  }

  startScan();
});

/* =========================================================
   RESET DA VOZ
========================================================= */

voiceReset.addEventListener("click", () => {
  /*
      Reseta apenas a parte
      da voz e da simulação.

      A frequência da taça
      permanece intacta.
    */

  voiceFreq = 0;

  waveformFrequency = 0;

  voiceCracked = false;

  resonanceStart = 0;

  resonanceTime = 0;

  voiceHz.textContent = "---";

  voiceLiveHz.textContent = "---";

  differenceHz.textContent = "---";

  voiceStatus.textContent = "🎙️ Faça um som constante...";

  energy.style.width = "0%";

  energyText.textContent = "0%";

  if (resonanceTimer) {
    resonanceTimer.textContent = "0,0 s";
  }

  if (breakProgress) {
    breakProgress.style.width = "0%";
  }

  crackMessage.textContent = "🍷 TAÇA INTACTA";

  crackMessage.style.color = "#aac8ff";

  /*
      Mantém o valor real da taça.
    */

  targetDisplay.textContent = Math.round(TARGET_FREQ);

  targetLiveHz.textContent = Math.round(TARGET_FREQ) + " Hz";
});

/* =========================================================
   APLICAR ALVO MANUALMENTE
========================================================= */

applyTarget.addEventListener("click", () => {
  const value = Number(targetInput.value);

  if (Number.isFinite(value) && value >= 50 && value <= 2000) {
    /*
        Permite alterar manualmente
        a frequência usada como alvo.
      */

    TARGET_FREQ = value;

    targetDisplay.textContent = value;

    targetLiveHz.textContent = value + " Hz";

    /*
        Se já existe leitura de voz,
        atualiza imediatamente.
      */

    if (voiceFreq > 0 && !voiceCracked) {
      /*
          Ao trocar o alvo,
          reiniciamos o tempo de ressonância.
        */

      resonanceStart = 0;

      resonanceTime = 0;

      if (resonanceTimer) {
        resonanceTimer.textContent = "0,0 s";
      }

      if (breakProgress) {
        breakProgress.style.width = "0%";
      }

      updateVoice(voiceFreq);
    }
  } else {
    targetInput.value = TARGET_FREQ;
  }
});

/* =========================================================
   CARREGAR FREQUÊNCIA SALVA
========================================================= */

const savedFreq = Number(localStorage.getItem("tacaFrequencia"));

if (Number.isFinite(savedFreq) && savedFreq >= 100 && savedFreq <= 4000) {
  TARGET_FREQ = Math.min(2000, savedFreq);

  targetDisplay.textContent = TARGET_FREQ;

  targetInput.value = TARGET_FREQ;

  targetLiveHz.textContent = TARGET_FREQ + " Hz";

  glassHz.textContent = TARGET_FREQ;

  glassHz.classList.add("found");

  savedInfo.textContent =
    "✓ Frequência salva anteriormente: " + savedFreq + " Hz";
}

/* =========================================================
   CANVAS DA TAÇA
========================================================= */

function drawGlass() {
  const w = glassCanvas.width;

  const h = glassCanvas.height;

  /*
    Fundo.
  */

  glassCtx.fillStyle = "#080d15";

  glassCtx.fillRect(0, 0, w, h);

  /*
    Grade vertical.
  */

  glassCtx.strokeStyle = "#16243a";

  glassCtx.lineWidth = 1;

  for (let x = 0; x < w; x += 60) {
    glassCtx.beginPath();

    glassCtx.moveTo(x, 0);

    glassCtx.lineTo(x, h);

    glassCtx.stroke();
  }

  /*
    Grade horizontal.
  */

  for (let y = 0; y < h; y += 60) {
    glassCtx.beginPath();

    glassCtx.moveTo(0, y);

    glassCtx.lineTo(w, y);

    glassCtx.stroke();
  }

  /*
    Espectro.
  */

  if (freqData) {
    const bars = 160;

    const step = Math.max(1, Math.floor(freqData.length / bars));

    const barWidth = w / bars;

    for (let i = 0; i < bars; i++) {
      let value = 0;

      for (let j = 0; j < step; j++) {
        value = Math.max(value, freqData[i * step + j] || 0);
      }

      const barHeight = (value / 255) * h * 0.75;

      glassCtx.fillStyle = "#27658a";

      glassCtx.fillRect(i * barWidth, h - barHeight, barWidth - 1, barHeight);
    }
  }

  /*
    Linha da melhor frequência
    encontrada.
  */

  if (bestFreq > 0 && audioContext) {
    const x = (bestFreq / (audioContext.sampleRate / 2)) * w;

    /*
      Evita desenhar fora do canvas.
    */

    if (x >= 0 && x <= w) {
      glassCtx.strokeStyle = "#ffb86b";

      glassCtx.lineWidth = 3;

      glassCtx.beginPath();

      glassCtx.moveTo(x, 0);

      glassCtx.lineTo(x, h);

      glassCtx.stroke();
    }
  }

  /*
    Texto.
  */

  glassCtx.fillStyle = "#64d8ff";

  glassCtx.font = "bold 17px monospace";

  glassCtx.fillText("FREQUÊNCIA DA TAÇA", 20, 30);

  /*
    Mostra a frequência definitiva.
  */

  if (TARGET_FREQ > 0) {
    glassCtx.fillStyle = "#ffb86b";

    glassCtx.fillText(Math.round(TARGET_FREQ) + " Hz", 20, 55);
  }

  requestAnimationFrame(drawGlass);
}

/* =========================================================
   CANVAS DA VOZ
========================================================= */

function drawVoice() {
  const w = voiceCanvas.width;

  const h = voiceCanvas.height;

  /*
    Fundo.
  */

  voiceCtx.fillStyle = "#080d15";

  voiceCtx.fillRect(0, 0, w, h);

  /*
    Grade.
  */

  voiceCtx.strokeStyle = "#16243a";

  voiceCtx.lineWidth = 1;

  for (let x = 0; x < w; x += 60) {
    voiceCtx.beginPath();

    voiceCtx.moveTo(x, 0);

    voiceCtx.lineTo(x, h);

    voiceCtx.stroke();
  }

  for (let y = 0; y < h; y += 60) {
    voiceCtx.beginPath();

    voiceCtx.moveTo(0, y);

    voiceCtx.lineTo(w, y);

    voiceCtx.stroke();
  }

  /*
    Linha central.
  */

  voiceCtx.strokeStyle = "#29405a";

  voiceCtx.beginPath();

  voiceCtx.moveTo(0, h / 2);

  voiceCtx.lineTo(w, h / 2);

  voiceCtx.stroke();

  /*
    Senoide limpa na frequência fundamental detectada.
  */

  if (micActive && voiceFreq > 0) {
    waveformFrequency =
      waveformFrequency === 0
        ? voiceFreq
        : waveformFrequency * 0.97 + voiceFreq * 0.03;

    const displayDuration = 0.03;

    voiceCtx.strokeStyle = voiceCracked ? "#ff4d6d" : "#64d8ff";

    voiceCtx.lineWidth = 2;

    voiceCtx.beginPath();

    for (let x = 0; x < w; x++) {
      const time = (x / (w - 1)) * displayDuration;
      const y =
        h / 2 -
        Math.sin(2 * Math.PI * waveformFrequency * time) * (h * 0.4);

      if (x === 0) {
        voiceCtx.moveTo(x, y);
      } else {
        voiceCtx.lineTo(x, y);
      }
    }

    voiceCtx.stroke();
  } else {
    waveformFrequency = 0;
  }

  /*
    Texto da voz.
  */

  voiceCtx.fillStyle = "#64d8ff";

  voiceCtx.font = "bold 18px monospace";

  voiceCtx.fillText(
    "SUA VOZ: " + (voiceFreq ? Math.round(voiceFreq) : "---") + " Hz",
    20,
    30,
  );

  voiceCtx.fillStyle = "#7890b0";

  voiceCtx.font = "13px monospace";

  voiceCtx.textAlign = "right";

  voiceCtx.fillText("ÚLTIMOS 30 ms", w - 20, 30);

  voiceCtx.textAlign = "left";

  /*
    Texto da taça.

    Este valor é separado
    da frequência da voz.
  */

  voiceCtx.fillStyle = "#ffb86b";

  voiceCtx.fillText("TAÇA: " + Math.round(TARGET_FREQ) + " Hz", 20, 58);

  /*
    Mensagem de quebra.
  */

  if (voiceCracked) {
    voiceCtx.fillStyle = "#ff4d6d";

    voiceCtx.font = "bold 30px Arial";

    voiceCtx.fillText("💥 TAÇA QUEBRADA 💥", w / 2 - 170, h / 2);
  }

  requestAnimationFrame(drawVoice);
}

/* =========================================================
   INICIAR GRÁFICOS
========================================================= */

drawGlass();

drawVoice();

/* =========================================================
   LIMPEZA AO SAIR
========================================================= */

window.addEventListener("beforeunload", () => {
  if (stream) {
    stream.getTracks().forEach((track) => {
      track.stop();
    });
  }
});