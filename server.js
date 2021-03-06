const express = require('express')
const {Server} = require("socket.io")
const {getVideoDurationInSeconds} = require("get-video-duration")
const http = require('http')
const fs = require('fs')
const app = express()
const server = http.createServer(app)
const io = new Server(server)

// 0 = countdown
// 1 = counter
// 2 = target timer
// 3 = now time

class Timer {
	type = 0
	_started = 0
	counted = 0
	paused = true
	position = 0
	
	constructor(position, title, down, type = 0) {
		this._started = down
		this.counted = down
		this.position = position
		this.title = title
		this.type = type ?? 0
		
		this.reset()

		if(this.type !== 0)
			this.start()
	}
	
	update() {
		if (this.type === 0) {
			if (this.counted <= 0) {
				video = null
				io.emit('video', video)
				return this.stop()
			}
			this.counted--
		}
		if (this.type === 1)
			this.counted++
		if (this.type === 2)
			this.counted = this._started - this.seconds
		if (this.type === 3)
			this.counted = this.seconds
	}
	
	reset() {
		if (this.type !== 3) {
			this.stop()
			this.counted = this._started ?? 0
		}
		
		if(this.paused && this.type !== 0)
			this.start()
	}

	start() {
		this.paused = false
	}
	
	stop() {
		this.paused = true
	}
	
	toJSON() {
		return {
			position: this.position,
			title: this.title,
			counted: this.counted,
			_started: this._started,
			paused: this.paused
		}
	}
	
	get seconds() {
		const date = new Date()
		return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()
	}
}

const config = require('./config')

const timers = [
	new Timer(0, "現在時間 (Now Time)", 0, 3),
	new Timer(1, "影片倒數 (Video Countdown)", 0, 0),
	new Timer(2, "距離直播開始 (Live Time)", parseTimeString(config.default.beginTime), 2),
	new Timer(3, "距離直播結束 (End Time)", parseTimeString(config.default.endTime), 2),
]

let videos = []

setInterval(() => {
	for(const timer of timers)
		if(!timer.paused)
			timer.update()
	io.emit('init', timers)
}, 1000)

const password = process.env.PASSWORD || config.password ||
	new Array(5).fill(0).map(() => Math.floor(Math.random() * 10)).join('')

let video

async function getVideos(duration = false) {
	if (!fs.existsSync("web/videos"))
		fs.mkdirSync("web/videos")
	
	const videos = fs.readdirSync("web/videos")
	.filter(x => /\.(mp4)$/.test(x))
	.map(x => ({
		link: x,
	}))

	if(duration)
		for (const vid of videos)
			vid.duration = Math.floor(
				await getVideoDurationInSeconds(`web/videos/${vid.link}`))
	
	return videos
}

app.use(express.static('web'))

getVideos(true)
.then((_videos) => videos = _videos)

io.on("connection", async (socket) => {
	socket.emit('init', timers.map(x => x?.toJSON()))
	socket.emit("init_videos", videos)

	if (video)
		socket.emit("video", video)
	
	function verify() {
		const verified = socket.handshake.auth.password === password
		if(socket.handshake.auth?.password !== null && !verified)
			socket.disconnect(true)
		return verified
	}
	
	socket.on("set_timer", (index, counted) => {
		if (!verify())
			return
		timers[index]._started = counted
		io.emit('init', timers.map(x => x?.toJSON()))
	})
	
	socket.on("set_video", async (link) => {
		if (!verify())
			return
		const _video = videos.find(x => x.link === link)
		if (!_video)
			return
		video = _video
		const timer = timers.find(x => x?.type === 0)
		timer.reset()
		timer._started = _video.duration
		timer.counted = timer._started
		io.emit('init', timers.map(x => x?.toJSON()))
		io.emit('video', video)
	})
	
	socket.on("play_video", () => {
		if (!verify() || !video)
			return
		const timer = timers.find(x => x?.type === 0)
		timer.start()
		io.emit('init', timers.map(x => x?.toJSON()))
		io.emit("play_video")
	})
	
	socket.on("pause_video", () => {
		if (!verify() || !video)
			return
		const timer = timers.find(x => x?.type === 0)
		timer.stop()
		io.emit('init', timers.map(x => x?.toJSON()))
		io.emit("pause_video")
	})
	
	socket.on("stop_video", () => {
		if (!verify() || !video)
			return
		const timer = timers.find(x => x?.type === 0)
		timer.reset()
		io.emit('init', timers.map(x => x?.toJSON()))
		io.emit("stop_video")
	})
	
	socket.on("black_screen", () => {
		if (!verify())
			return
		video = null
		const timer = timers.find(x => x?.type === 0)
		timer.reset()
		timer._started = 0
		timer.counted = 0
		io.emit('init', timers.map(x => x?.toJSON()))
		io.emit('video', video)
	})

	socket.on("refresh_video", async () => {
		if(!verify())
			return
		videos = await getVideos(true)
		socket.emit("init_videos", videos)
	})
})

function parseTimeString(str) {
	const s = str.split(":")
	let t = 0
	if (s.length === 3)
		t += parseInt(s[0]) * 3600 + parseInt(s[1]) * 60 + parseInt(s[2])
	else
		t += parseInt(s[0]) * 60 + parseInt(s[1])
	return t
}

const port = config.port || Number(process.env.PORT) || 3000
server.listen(port, () => console.log(`Listening on port ${port}, password is: ${password}`))