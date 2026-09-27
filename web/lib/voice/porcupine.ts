import { PorcupineWorker } from '@picovoice/porcupine-web'

interface PorcupineSession {
  stop: () => Promise<void>
}

export async function initPorcupine(
  onWakeWord: () => void
): Promise<PorcupineSession | null> {
  try {
    const worker = await PorcupineWorker.create(
      process.env.NEXT_PUBLIC_PICOVOICE_ACCESS_KEY!,
      [{ publicPath: '/porcupine/meridian_en_wasm.ppn', label: 'Meridian', sensitivity: 0.5 }],
      (detection) => {
        if (detection.label === 'Meridian') onWakeWord()
      },
      { publicPath: '/porcupine/porcupine_params.pv' }
    )

    // Capture mic audio and feed PCM frames to Porcupine
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    const audioCtx = new AudioContext({ sampleRate: worker.sampleRate })
    const source = audioCtx.createMediaStreamSource(stream)

    // ScriptProcessorNode: deprecated but universally supported without a worklet file
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const processor = audioCtx.createScriptProcessor(worker.frameLength, 1, 1)
    processor.onaudioprocess = (e) => {
      const float32 = e.inputBuffer.getChannelData(0)
      const int16 = new Int16Array(float32.length)
      for (let i = 0; i < float32.length; i++) {
        int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768))
      }
      worker.process(int16)
    }
    source.connect(processor)
    processor.connect(audioCtx.destination)

    return {
      stop: async () => {
        processor.disconnect()
        source.disconnect()
        stream.getTracks().forEach(t => t.stop())
        await audioCtx.close()
        await worker.release()
        worker.terminate()
      },
    }
  } catch (err) {
    console.warn('Porcupine wake word init failed — degrading to push-to-activate', err)
    return null
  }
}
