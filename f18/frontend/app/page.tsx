'use client';

import { useState, useEffect } from 'react';
import { saveAs } from 'file-saver';
import SimpleInput from '../components/SimpleInput';
import TrackMixer from '../components/TrackMixer';
import MultiTrackPianoRoll from '../components/MultiTrackPianoRoll';
import MultiTrackPlayer from '../components/MultiTrackPlayer';

interface Note {
  pitch: number;
  start_time: number;
  duration: number;
  velocity: number;
}

interface TrackState {
  volume: number;
  muted: boolean;
  solo: boolean;
}

const TRACK_COLORS: Record<string, string> = {
  piano: '#3b82f6',
  guitar: '#10b981',
  bass: '#f59e0b',
  drums: '#ef4444'
};

const TRACK_NAMES: Record<string, string> = {
  piano: '钢琴',
  guitar: '吉他',
  bass: '贝斯',
  drums: '鼓组'
};

export default function Home() {
  const [style, setStyle] = useState('electronic');
  const [emotion, setEmotion] = useState('happy');
  const [inputNotes, setInputNotes] = useState<Note[]>([]);
  const [tracks, setTracks] = useState<Record<string, Note[]>>({});
  const [trackStates, setTrackStates] = useState<Record<string, TrackState>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [midiBase64, setMidiBase64] = useState('');
  const [temperature, setTemperature] = useState(1.0);
  const [activeTrack, setActiveTrack] = useState('piano');
  const [generationTime, setGenerationTime] = useState<number>(0);

  const hasTracks = Object.keys(tracks).length > 0;

  const generateMultiTrack = async () => {
    if (inputNotes.length === 0) {
      alert('请先输入一些简谱音符！');
      return;
    }

    setIsGenerating(true);
    const startTime = Date.now();

    try {
      const response = await fetch('http://localhost:8000/api/generate/multitrack', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          style,
          emotion,
          input_notes: inputNotes,
          temperature,
          num_bars: 16,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setTracks(data.tracks);
        setMidiBase64(data.midi_base64);
        setGenerationTime(data.processing_time_ms);

        const initialStates: Record<string, TrackState> = {};
        Object.keys(data.tracks).forEach(track => {
          initialStates[track] = {
            volume: 100,
            muted: false,
            solo: false
          };
        });
        setTrackStates(initialStates);
      }
    } catch (error) {
      console.error('生成音乐失败:', error);
      alert('生成音乐失败，请确保后端服务正在运行！');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleTrackChange = (track: string, state: Partial<TrackState>) => {
    setTrackStates(prev => ({
      ...prev,
      [track]: { ...prev[track], ...state }
    }));
  };

  const getMutedTracks = () => {
    return Object.entries(trackStates)
      .filter(([_, state]) => state.muted)
      .map(([track]) => track);
  };

  const getTrackVolumes = () => {
    const volumes: Record<string, number> = {};
    Object.entries(trackStates).forEach(([track, state]) => {
      volumes[track] = state.volume;
    });
    return volumes;
  };

  const exportMultiTrackMidi = async () => {
    if (!hasTracks) {
      alert('请先生成音乐！');
      return;
    }

    try {
      const response = await fetch('http://localhost:8000/api/export/multitrack', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          style,
          emotion,
          input_notes: inputNotes,
          temperature,
          num_bars: 16,
          track_volumes: getTrackVolumes(),
          muted_tracks: getMutedTracks()
        }),
      });

      const data = await response.json();
      if (data.success) {
        const byteCharacters = atob(data.midi_base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'audio/midi' });
        saveAs(blob, `${style}_${emotion}_multitrack.mid`);
      }
    } catch (error) {
      console.error('导出失败:', error);
      alert('导出失败！');
    }
  };

  const exportMidi = () => {
    if (!midiBase64) {
      alert('请先生成音乐！');
      return;
    }
    const byteCharacters = atob(midiBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'audio/midi' });
    saveAs(blob, 'generated_music.mid');
  };

  const totalNotes = Object.values(tracks).flat().length;

  return (
    <main className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl md:text-4xl font-bold text-white text-center mb-8">
          🎵 AI 多轨音乐生成器
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
              <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                <span className="text-2xl">⚙️</span> 生成设置
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-white mb-2 font-medium text-sm">选择曲风</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['jazz', 'classical', 'electronic'].map((s) => (
                      <button
                        key={s}
                        onClick={() => setStyle(s)}
                        className={`py-2 px-3 rounded-lg font-medium text-sm transition-all ${
                          style === s
                            ? 'bg-purple-500 text-white shadow-lg'
                            : 'bg-white/20 text-white/80 hover:bg-white/30'
                        }`}
                      >
                        {s === 'jazz' ? '🎷 爵士' : s === 'classical' ? '🎻 古典' : '🎹 电子'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-white mb-2 font-medium text-sm">选择情绪</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['happy', 'sad', 'energetic'].map((e) => (
                      <button
                        key={e}
                        onClick={() => setEmotion(e)}
                        className={`py-2 px-3 rounded-lg font-medium text-sm transition-all ${
                          emotion === e
                            ? 'bg-pink-500 text-white shadow-lg'
                            : 'bg-white/20 text-white/80 hover:bg-white/30'
                        }`}
                      >
                        {e === 'happy' ? '😊 欢快' : e === 'sad' ? '😢 悲伤' : '🔥 激昂'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-white mb-2 font-medium text-sm">
                    创意度: {temperature.toFixed(2)}
                  </label>
                  <input
                    type="range"
                    min="0.1"
                    max="2"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-white/60 text-xs mt-1">
                    <span>保守</span>
                    <span>创意</span>
                  </div>
                </div>

                <div>
                  <label className="block text-white mb-2 font-medium text-sm">简谱输入 (最多8小节)</label>
                  <SimpleInput onNotesChange={setInputNotes} />
                  <p className="text-white/60 text-xs mt-2">
                    已输入 {inputNotes.length} 个音符
                  </p>
                </div>

                <button
                  onClick={generateMultiTrack}
                  disabled={isGenerating}
                  className="w-full py-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl font-bold text-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                >
                  {isGenerating ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      AI正在创作中...
                    </span>
                  ) : (
                    '✨ 生成多轨音乐'
                  )}
                </button>

                {generationTime > 0 && (
                  <div className="text-center text-white/60 text-sm">
                    生成耗时: {generationTime.toFixed(1)}ms
                  </div>
                )}
              </div>
            </div>

            {hasTracks && (
              <TrackMixer
                tracks={Object.keys(tracks)}
                trackColors={TRACK_COLORS}
                trackNames={TRACK_NAMES}
                trackNotes={tracks}
                onTrackChange={handleTrackChange}
                onExport={exportMultiTrackMidi}
              />
            )}
          </div>

          <div className="lg:col-span-8 space-y-6">
            {hasTracks && (
              <MultiTrackPlayer
                tracks={tracks}
                trackVolumes={getTrackVolumes()}
                mutedTracks={getMutedTracks()}
                isPlaying={isPlaying}
                onPlayStateChange={setIsPlaying}
              />
            )}

            {hasTracks ? (
              <MultiTrackPianoRoll
                tracks={tracks}
                trackColors={TRACK_COLORS}
                trackNames={TRACK_NAMES}
                activeTrack={activeTrack}
                onTrackSelect={setActiveTrack}
              />
            ) : (
              <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-12 text-center">
                <div className="text-6xl mb-4">🎼</div>
                <h3 className="text-xl font-semibold text-white mb-2">等待生成</h3>
                <p className="text-white/60">
                  输入简谱并点击"生成多轨音乐"按钮，AI将为您创作包含钢琴、吉他、贝斯和鼓的完整乐曲。
                </p>
              </div>
            )}

            {hasTracks && (
              <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-white">📊 生成统计</h3>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setIsPlaying(!isPlaying)}
                      className={`px-4 py-2 rounded-lg font-medium transition-all ${
                        isPlaying
                          ? 'bg-red-500 text-white'
                          : 'bg-green-500 text-white hover:bg-green-600'
                      }`}
                    >
                      {isPlaying ? '⏹ 停止' : '▶ 播放'}
                    </button>
                    <button
                      onClick={exportMultiTrackMidi}
                      className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-all"
                    >
                      📥 导出MIDI
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Object.entries(tracks).map(([track, notes]) => (
                    <div
                      key={track}
                      className="p-4 rounded-xl bg-gray-900/50 border"
                      style={{ borderColor: TRACK_COLORS[track] }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{ backgroundColor: TRACK_COLORS[track] }}
                        >
                          {track === 'piano' && '🎹'}
                          {track === 'guitar' && '🎸'}
                          {track === 'bass' && '🎸'}
                          {track === 'drums' && '🥁'}
                        </div>
                        <span className="text-white font-medium">{TRACK_NAMES[track]}</span>
                      </div>
                      <div className="text-2xl font-bold text-white">{notes.length}</div>
                      <div className="text-xs text-white/60">个音符</div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 pt-4 border-t border-white/20 text-center">
                  <span className="text-white/60">总计: </span>
                  <span className="text-2xl font-bold text-white">{totalNotes}</span>
                  <span className="text-white/60"> 个音符</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 bg-white/10 backdrop-blur-lg rounded-2xl p-6">
          <h3 className="text-xl font-semibold text-white mb-4">🎯 使用说明</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-white/80">
            <div className="bg-white/5 p-4 rounded-xl">
              <h4 className="font-medium text-white mb-2">1. 输入简谱</h4>
              <p className="text-sm">点击钢琴键输入一段旋律，作为AI创作的起点和灵感来源。</p>
            </div>
            <div className="bg-white/5 p-4 rounded-xl">
              <h4 className="font-medium text-white mb-2">2. 选择风格</h4>
              <p className="text-sm">选择爵士、古典或电子曲风，配合欢快、悲伤或激昂的情绪。</p>
            </div>
            <div className="bg-white/5 p-4 rounded-xl">
              <h4 className="font-medium text-white mb-2">3. 混音调节</h4>
              <p className="text-sm">在混音器中调节各轨道音量，静音不需要的轨道，单独试听轨道。</p>
            </div>
            <div className="bg-white/5 p-4 rounded-xl">
              <h4 className="font-medium text-white mb-2">4. 导出版本</h4>
              <p className="text-sm">满意后导出标准MIDI文件，可在任何音乐制作软件中继续编辑。</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
