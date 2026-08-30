if (navigator.userAgent.includes("Android"))
	import("eruda").then(({ default: eruda }) => eruda.init());