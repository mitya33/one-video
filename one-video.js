//init - prep work and load API (unless native video)
window.onevideo = window.onevideo || function(el) {

	//prep
	const	app = 'onevideo',
			log_prfx = app.substr(0, 1).toUpperCase()+app.substr(1)+': ',
			api_urls = {
				yt: 'https://www.youtube.com/iframe_api',
				vimeo: 'https://player.vimeo.com/api/player.js'
			};

	//return promise for when API ready
	return new Promise(res => {

		//establish element - embed iframe or native video tag
		el = typeof el == 'string' ? document.querySelector(el) : el;
		if (!el) return console.error(log_prfx+'no element found');

		//establish video source
		let source;
		if (el.tagName == 'IFRAME') {
			let src = el.getAttribute('src');
			if (src.includes('youtube')) source = 'yt';
			else if (src.includes('vimeo')) source = 'vimeo';
			else return console.error(log_prfx+'embed is not from YouTube or Vimeo');
		} else if (el.tagName == 'VIDEO')
			source = 'n';
		else
			return console.error(log_prfx+'element is not a <video> or <iframe> element');

		//load API, if YouTube or Vimeo, unless already done it...
		if (['yt', 'vimeo'].includes(source)) {
			if (window[app]['loaded_'+source+'_api']) return res(new onevideo.Player(el, source));
			let scr = document.createElement('script');
			scr.onload = () => {
				window[app]['loaded_'+source+'_api'] = 1;

			//...if YouTube, have to wait for API ready event to fire. Also ensure player allows JS access!
			if (source == 'yt') {
				if (!el.id) el.id = app+'-'+Math.random();
				if (!/enablejsapi=(1|true)/.test(el.src)) el.src += (!el.src.includes('?') ? '?' : '&')+'enablejsapi=1';
				window.onYouTubeIframeAPIReady = () => res(new onevideo.Player(el, 'yt'));
			} else
				res(new onevideo.Player(el, 'vimeo'));
			};
			document.head.appendChild(scr);
			scr.src = api_urls[source];

		//else if native video, just resolve - no API to load
		} else
			res(new onevideo.Player(el, 'n'));

	});

};

//harmonised player constructor...
onevideo.Player = function(el, source) {

	this.source = source;

	//...create player
	switch (source) {
		case 'vimeo': this.player = new Vimeo.Player(el); break;
		case 'yt': this.player = new YT.Player(el.id); break;
		case 'n': this.player = el; break;
	}

	//...establish valid events (based on the Vimeo API)
	this.evt_types = ['play', 'pause', 'timeupdate', 'ended', 'ready', 'seeked'];

	//...YouTube equivalents - note, Vimeo equivalents are arrays as Vimeo has multiple, split events where YT has one
	this.yt_to_vim_evts_map = {
		onStateChange: ['play', 'timeupdate', 'pause', 'ended'],
		onReady: ['ready']
	};
	if (source == 'yt') {
		this.yt_ontimeupdate_int;
		this.on('pause', () => clearInterval(this.yt_ontimeupdate_int));
	}

	//...native (HTML5) video equivalents
	this.native_to_vim_evts_map = {
		timeupdate: 'timeupdate',
		seeked: 'seeked',
		play: 'play',
		pause: 'pause',
		ended: 'ended',
		ready: 'canplay'
	};

	//handle XSecondsReached-format events - either reaching a specific seconds points, or equal to or beyond a specific seconds point
	this.listen_for_seconds = {};
	this.last_full_second_seen;
	this.on('timeupdate', () => {
		this.getCurrentTime().then(secs => {
			secs = parseInt(secs);
			if (this.listen_for_seconds[secs] && secs != this.last_full_second_seen) this.listen_for_seconds[secs]();
			for (point in this.listen_for_seconds) if (/\+$/.test(point) && secs >= parseInt(point)) this.listen_for_seconds[point]();
			this.last_full_second_seen = secs;
		});
	});

};

//API...
onevideo.Player.prototype = {

	//...register a @callback to run when @event fires. @event should be one of the event names from the Vimeo player API...
	on(evt, callback) {

		//...custom XSecondsReached events e.g. when a specific number of seconds reached
		let ptn = /^(\d+\+?)SecondsReached$/;
		if (ptn.test(evt)) return this.listen_for_seconds[evt.match(ptn)[1]] = callback;

		//...else standard event...

		switch (this.source) {

			//...Vimeo
			case 'vimeo':
				evt != 'ready' ?
					this.player.on(evt, callback) :
					this.player.ready().then(callback);
				break;

			//...YouTube - note: timeupdate fires only once, not continuinously like Vimeo/native, so fire callback repeatedly via an interval
			case 'yt':
				let yt_evt = (() => {
					for (let yt_evt in this.yt_to_vim_evts_map)
						if (this.yt_to_vim_evts_map[yt_evt].includes(evt))
							return yt_evt;
				})();
				if (yt_evt == 'onStateChange')
					this.player.addEventListener(yt_evt, ((evt, cb) => { return evt_data => {
						if (evt == 'play' && evt_data.data === 1) cb(evt_data);
						if (evt == 'pause' && evt_data.data === 2) cb(evt_data);
						if (evt == 'timeupdate' && evt_data.data === 1) this.yt_ontimeupdate_int = setInterval(cb, 500);
						if (evt == 'ended' && evt_data.data === 0) { this.log('ended'); cb(evt_data); }
					}; })(evt, callback));
				else
					this.player.addEventListener(yt_evt, callback);
				break;

			//...native - mostly like Vimeo, except ready is an event, not a method+promise as with Vimeo
			case 'n':
				if (evt != 'ready' || this.player.readyState < 2)
					this.player.addEventListener(this.native_to_vim_evts_map[evt], callback);
				else
					callback.call(this.player);
			break;

		}

	},

	//...play
	play() { switch (this.source) {
		case 'vimeo': case 'n': this.player.play(); break;
		case 'yt': this.player.playVideo(); break;
	}},

	//...pause
	pause() { switch (this.source) {
		case 'vimeo': case 'n': this.player.pause(); break;
		case 'yt': this.player.pauseVideo(); break;
		case 'n': this.player_el.pause(); break;
	}},

	//...seek
	seekTo(secs) { switch (this.source) {
		case 'vimeo': this.player.setCurrentTime(secs); break;
		case 'yt': this.player.seekTo(secs); break;
		case 'n': this.player.currentTime = secs; break;
	}},

	//...the following methods all return promises, since their results are not synchronously ascertainable...

	//...get current time (secs)
	getCurrentTime() {
		return new Promise(res => {
			switch (this.source) {
				case 'vimeo': this.player.getCurrentTime().then(secs => res(Math.floor(secs))); break;
				case 'yt': res(Math.floor(this.player.getCurrentTime()));
				case 'n': res(Math.floor(this.player.currentTime)); break;
			}
		});
	},

	//...get duration (secs)
	getDuration() {
		return new Promise(res => {
			switch (this.source) {
				case 'vimeo': this.player.getDuration().then(duration => res(duration)); break;
				case 'yt': res(this.player.getDuration()); break;
				case 'n': res(Math.floor(this.player.duration)); break;
			}
		});
	},

	//...get width - the promise is resolved with a string, '4-3', '16-9' or 'portrait' (for phone vids)
	getAspect() {
		return new Promise(res => {
			switch (this.source) {
				case 'vimeo': Promise.all([this.player.getVideoWidth(), this.player.getVideoHeight()]).then(dims => {
					res(aspStr(dims[0], dims[1]));
				}); break;
				case 'yt': res('16-9'); break;
				case 'n': res(aspStr(this.player.videoWidth, this.player.videoHeight)); break;
			}
		});
		let aspStr = (w, h) => {
			if (h / w >= .56 && h / w <= .565) return '16-9'; //<-- seems not all 16:9 is exactly .5625 so allow some room
			if (h / w === .75) return '4-3';
			return' portrait';
		}
	},

	//...get player
	getPlayer() {
		return 
	}

};