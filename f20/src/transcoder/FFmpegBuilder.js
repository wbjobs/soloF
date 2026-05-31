class FFmpegBuilder {
  constructor() {
    this.args = [
      '-hide_banner',
      '-loglevel', 'info',
      '-y'
    ];
    this.inputs = [];
    this.filterComplex = [];
    this.outputs = [];
  }

  addRtpInput(audioPort, videoPort) {
    this.args.push(
      '-fflags', '+nobuffer+genpts+discardcorrupt',
      '-avioflags', 'direct',
      '-flags', 'low_delay',
      '-strict', '-2',
      '-analyzeduration', '500000',
      '-probesize', '500000',
      '-protocol_whitelist', 'rtp,udp,file',
      '-i', `rtp://127.0.0.1:${audioPort}`,
      '-i', `rtp://127.0.0.1:${videoPort}`
    );
    return this;
  }

  addFileInput(filePath) {
    this.args.push('-i', filePath);
    return this;
  }

  setVideoCodec(codec) {
    this.videoCodec = codec;
    return this;
  }

  setAudioCodec(codec) {
    this.audioCodec = codec;
    return this;
  }

  setVideoSize(width, height) {
    this.videoWidth = width;
    this.videoHeight = height;
    return this;
  }

  setVideoBitrate(bitrate) {
    this.videoBitrate = bitrate;
    return this;
  }

  setAudioBitrate(bitrate) {
    this.audioBitrate = bitrate;
    return this;
  }

  setFrameRate(fps) {
    this.frameRate = fps;
    return this;
  }

  getPositionFilter(position) {
    const positions = {
      'top-left': '10:10',
      'top-center': '(main_w-overlay_w)/2:10',
      'top-right': 'main_w-overlay_w-10:10',
      'center-left': '10:(main_h-overlay_h)/2',
      'center': '(main_w-overlay_w)/2:(main_h-overlay_h)/2',
      'center-right': 'main_w-overlay_w-10:(main_h-overlay_h)/2',
      'bottom-left': '10:main_h-overlay_h-10',
      'bottom-center': '(main_w-overlay_w)/2:main_h-overlay_h-10',
      'bottom-right': 'main_w-overlay_w-10:main_h-overlay_h-10'
    };
    return positions[position] || positions['bottom-right'];
  }

  addTextWatermark(text, fontSize, fontColor, position) {
    const posFilter = this.getPositionFilter(position);
    const filter = `drawtext=text='${text}':fontsize=${fontSize}:fontcolor=${fontColor}:x=${posFilter}:shadowcolor=black:shadowx=2:shadowy=2`;
    this.filterComplex.push(filter);
    return this;
  }

  addImageWatermark(imagePath, position) {
    const posFilter = this.getPositionFilter(position);
    const filter = `[1:v]scale=100:-1[wm];[0:v][wm]overlay=${posFilter}`;
    this.filterComplex.push(filter);
    return this;
  }

  addPiP(pipInputs, layout) {
    const inputCount = pipInputs.length;
    let layoutFilter = '';

    if (layout === 'grid') {
      if (inputCount === 1) {
        layoutFilter = '[1:v]scale=iw/3:ih/3[pip1];[0:v][pip1]overlay=main_w-overlay_w-10:main_h-overlay_h-10';
      } else if (inputCount === 2) {
        layoutFilter = '[1:v]scale=iw/3:ih/3[pip1];[2:v]scale=iw/3:ih/3[pip2];[0:v][pip1]overlay=main_w-overlay_w-10:10[vid];[vid][pip2]overlay=main_w-overlay_w-10:main_h-overlay_h-10';
      } else if (inputCount === 3) {
        layoutFilter = '[1:v]scale=iw/3:ih/3[pip1];[2:v]scale=iw/3:ih/3[pip2];[3:v]scale=iw/3:ih/3[pip3];[0:v][pip1]overlay=main_w-overlay_w-10:10[vid1];[vid1][pip2]overlay=main_w-overlay_w-10:main_h/2-overlay_h/2[vid2];[vid2][pip3]overlay=main_w-overlay_w-10:main_h-overlay_h-10';
      } else if (inputCount === 4) {
        layoutFilter = '[1:v]scale=iw/4:ih/4[pip1];[2:v]scale=iw/4:ih/4[pip2];[3:v]scale=iw/4:ih/4[pip3];[4:v]scale=iw/4:ih/4[pip4];[0:v][pip1]overlay=10:10[vid1];[vid1][pip2]overlay=main_w-overlay_w-10:10[vid2];[vid2][pip3]overlay=10:main_h-overlay_h-10[vid3];[vid3][pip4]overlay=main_w-overlay_w-10:main_h-overlay_h-10';
      }
    } else if (layout === 'side-by-side') {
      layoutFilter = '[0:v]scale=iw/2:ih[left];[1:v]scale=iw/2:ih[right];[left][right]hstack';
    }

    if (layoutFilter) {
      this.filterComplex.push(layoutFilter);
    }

    return this;
  }

  setHlsOutput(outputPath, segmentDuration, listSize) {
    this.hlsOutput = {
      path: outputPath,
      segmentDuration,
      listSize
    };
    return this;
  }

  build() {
    if (this.filterComplex.length > 0) {
      this.args.push('-filter_complex', this.filterComplex.join(';'));
    }

    if (this.videoCodec) {
      this.args.push('-c:v', this.videoCodec);
    }

    if (this.audioCodec) {
      this.args.push('-c:a', this.audioCodec);
    }

    if (this.videoWidth && this.videoHeight) {
      this.args.push('-s', `${this.videoWidth}x${this.videoHeight}`);
    }

    if (this.videoBitrate) {
      this.args.push('-b:v', this.videoBitrate);
    }

    if (this.audioBitrate) {
      this.args.push('-b:a', this.audioBitrate);
    }

    if (this.frameRate) {
      this.args.push('-r', this.frameRate.toString());
    }

    this.args.push(
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-g', (this.frameRate * 1).toString(),
      '-keyint_min', (this.frameRate * 1).toString(),
      '-sc_threshold', '0',
      '-bf', '0',
      '-refs', '1',
      '-rc-lookahead', '0',
      '-x264opts', 'no-mbtree:sync-lookahead=0:rc-lookahead=0',
      '-max_delay', '0',
      '-muxdelay', '0',
      '-muxpreload', '0',
      '-flags', '+cgop'
    );

    if (this.hlsOutput) {
      this.args.push(
        '-f', 'hls',
        '-hls_time', this.hlsOutput.segmentDuration.toString(),
        '-hls_list_size', this.hlsOutput.listSize.toString(),
        '-hls_flags', 'low_latency+delete_segments+append_list+independent_segments+program_date_time',
        '-hls_playlist_type', 'event',
        '-hls_segment_type', 'mpegts',
        '-hls_fmp4_init_filename', 'init.mp4',
        '-hls_fmp4_init_resend', '0',
        '-hls_start_number_source', 'epoch',
        '-hls_delete_threshold', '1',
        '-hls_segment_filename', this.hlsOutput.path.replace('.m3u8', '_%03d.ts'),
        '-flush_packets', '1',
        this.hlsOutput.path
      );
    }

    return this.args;
  }
}

export default FFmpegBuilder;
