var ftp_entries = {};

function ab2str(buf) {
	return String.fromCharCode.apply(null, new Uint8Array(buf));
}

function str2ab(str) {
	var buf = new ArrayBuffer(str.length);
	var bufView = new Uint8Array(buf);
	for (var i=0, strLen=str.length; i < strLen; i++) {
		bufView[i] = str.charCodeAt(i);
	}
	return buf;
}

function splitPath(path) {
		var matches = /([\s\S]*)\/([^\/]+)/.exec(path);

		if (matches[1] == "")
			matches[1] = "/";

		return matches;
}

function run_ftp(options, cmds, successCallback, errorCallback, receiveCallback) {
	chrome.sockets.tcp.create({}, function(createInfo) {
		var matches = /([^\s:]+)@([^\s:]+):(\d+)/.exec(options.fileSystemId);
		var address = matches[2];
		var port = parseInt(matches[3]);
		var user = matches[1];
		var password = options.password ? options.password : ftp_entries[options.fileSystemId].password;

		var onReceive = function(info) {
			if (info.socketId != createInfo.socketId)
				return;

			switch(parseInt(ab2str(info.data))) {
				case 220: // Welcome to FTP server.
					chrome.sockets.tcp.send(info.socketId, str2ab("USER " + user + "\r\n"), function(sendInfo) {});
					break;

				case 331: // Please specify the password.
					chrome.sockets.tcp.send(info.socketId, str2ab("PASS " + password + "\r\n"), function(sendInfo) {});
					break;

				case 230: // Login successful.
					chrome.sockets.tcp.send(info.socketId, str2ab("TYPE I\r\n"), function(sendInfo) {});
					break;

				case 200: // Switching to Binary mode.
					chrome.sockets.tcp.send(info.socketId, str2ab(cmds.shift()), function(sendInfo) {});
					break;

				case 227: // Entering Passive Mode.
					chrome.sockets.tcp.create({}, function(createInfo) {
						onDataReceive = function(info) {
							if (info.socketId != createInfo.socketId)
								return;

							if (receiveCallback && receiveCallback(info.data))
								chrome.sockets.tcp.disconnect(createInfo.socketId, function() {
						//			chrome.sockets.tcp.onReceive.removeListener(onDataReceive);
						//			chrome.sockets.tcp.close(createInfo.socketId);
								});
						}
						
						onDataReceiveError = function(info) {
							if (info.socketId != createInfo.socketId)
								return;

							chrome.sockets.tcp.disconnect(createInfo.socketId, function() {
								chrome.sockets.tcp.onReceive.removeListener(onDataReceive);
								chrome.sockets.tcp.close(createInfo.socketId);
							});							
						}
						
						chrome.sockets.tcp.onReceive.addListener(onDataReceive);

						chrome.sockets.tcp.send(info.socketId, str2ab(cmds.shift()), function(sendInfo) {});

						var matches = /\((\d+)\,(\d+)\,(\d+)\,(\d+)\,(\d+)\,(\d+)\)/.exec(ab2str(info.data));
						chrome.sockets.tcp.connect(createInfo.socketId, address, parseInt(matches[5]) * 256 + parseInt(matches[6]), function(result) {
							if (result < 0)
								errorCallback("IO");
							else if (options.data) {
								chrome.sockets.tcp.send(createInfo.socketId, options.data, function(sendInfo) {
									if (sendInfo.resultCode < 0)
										errorCallback("IO");
									else
										chrome.sockets.tcp.disconnect(createInfo.socketId, function() {
											chrome.sockets.tcp.onReceive.removeListener(onDataReceive);
											chrome.sockets.tcp.close(createInfo.socketId);
										});
								});
							}
						});
					});
					break;

				case 150: // Ok to send data.
					break;

				case 421: 
					break;
					
				case 350: // Ready for RNTO.
					chrome.sockets.tcp.send(info.socketId, str2ab(cmds.shift()), function(sendInfo) {});
					break;
					
				case 215: // UNIX Type: L8
				case 226: // Directory send OK.
				case 250: // Remove directory operation successful.
				case 257: // "directory" created
					chrome.sockets.tcp.send(info.socketId, str2ab("QUIT\r\n"), function(sendInfo) {
						successCallback();
					});
					break;

				case 450:
					errorCallback("NOT_FOUND");
					break;

				case 550:
					errorCallback("FAILED");
					break;

				case 530: // Login incorrect
					errorCallback("SECURITY");
					break;

				case 221:
					chrome.sockets.tcp.disconnect(info.socketId, function() {
						chrome.sockets.tcp.onReceive.removeListener(onReceive);
						chrome.sockets.tcp.close(info.socketId, function() {});
					});
					break;
			}
		};

		chrome.sockets.tcp.onReceive.addListener(onReceive);
		
		chrome.sockets.tcp.connect(createInfo.socketId, address, port, function(result) {
			if (result < 0)
				errorCallback("INVALID_URL");
		});
	});
	
}

chrome.fileSystemProvider.onUnmountRequested.addListener(function(options, successCallback, errorCallback) {
	successCallback();
	chrome.fileSystemProvider.unmount({
		fileSystemId: options.fileSystemId
	}, function() {
		delete ftp_entries[options.fileSystemId];
	});
});

chrome.fileSystemProvider.onGetMetadataRequested.addListener(function(options, successCallback, errorCallback) {
	var metadata = {};
	
	if (options.entryPath == "/") {
		if (options.isDirectory)
			metadata["isDirectory"] = true;
		if (options.name)
			metadata["name"] = "/";
		if (options.size)
			metadata["size"] = 2;
		if (options.modificationTime)
			metadata["modificationTime"] = new Date();

		successCallback(metadata);
		return;
	} else {
		var matches = splitPath(options.entryPath);
		if (matches[1] == "")
			matches[2] = "/";
		
		var entry = ftp_entries[options.fileSystemId][matches[1]][matches[2]];
		if (entry) {
			if (options.isDirectory)
				metadata["isDirectory"] = entry.isDirectory;
			if (options.name)
				metadata["name"] = entry.name;
			if (options.size)
				metadata["size"] = entry.size;
			if (options.modificationTime)
				metadata["modificationTime"] = entry.modificationTime;

			successCallback(metadata);
			return;
		}
	}
															 
	errorCallback("NOT_FOUND");
});

chrome.fileSystemProvider.onReadDirectoryRequested.addListener(function(options, successCallback, errorCallback) {
	var path_entries = ftp_entries[options.fileSystemId][options.directoryPath];
	if (path_entries) {
		var entries = [], entry, e;

		for (var key in path_entries) {
			entry = {};
			if (options.isDirectory)
				entry["isDirectory"] = path_entries[key].isDirectory;
			if (options.name)
				entry["name"] = path_entries[key].name;
			if (options.size)
				entry["size"] = path_entries[key].size;
			if (options.modificationTime)
				entry["modificationTime"] = path_entries[key].modificationTime;

			entries.push(entry);
		}
		successCallback(entries, false);
		return false;
	}
	
	path_entries = []; 
	ftp_entries[options.fileSystemId][options.directoryPath] = path_entries;
		
	run_ftp(options, ["PASV\r\n", "LIST " + options.directoryPath + "\r\n"], function() {
		successCallback([], false);
	}, errorCallback, function(data) {
		var pattern = /(\S)\S+\s+\d+\s+\d+\s+\d+\s+(\d+)\s+(\S+\s+\S+\s+\S+)\s+(\S+)/g;
		var str = ab2str(data);
		var matches;
		var entries = [], entry, e;

		while(matches = pattern.exec(str)) {
			e = {
				isDirectory: (matches[1] == "d") ? true : false,
				name: matches[4],
				size: parseInt(matches[2]),
				modificationTime: new Date(matches[3])
			};
			entry = {};
			if (options.isDirectory)
				entry["isDirectory"] = e.isDirectory;
			if (options.name)
				entry["name"] = e.name;
			if (options.size)
				entry["size"] = e.size;
			if (options.modificationTime)
				entry["modificationTime"] = e.modificationTime;

			path_entries[e.name] = e;
			entries.push(entry);
		}			
		successCallback(entries, true);
		return false;
	});
});

chrome.fileSystemProvider.onOpenFileRequested.addListener(function(options, successCallback, errorCallback) {
	successCallback();
});

chrome.fileSystemProvider.onCloseFileRequested.addListener(function(options, successCallback, errorCallback) {
	successCallback();
});

chrome.fileSystemProvider.onMoveEntryRequested.addListener(function(options, successCallback, errorCallback) {
	run_ftp(options, ["RNFR " + options.sourcePath + "\r\n", "RNTO " + options.targetPath + "\r\n"], function() {
		var ftp = ftp_entries[options.fileSystemId];
		var matcheSource = splitPath(options.sourcePath);
		var matcheTarget = splitPath(options.targetPath);

		ftp[matcheTarget[1]][matcheTarget[2]] = ftp[matcheSource[1]][matcheSource[2]];
		delete ftp[matcheSource[1]][matcheSource[2]];
		ftp[matcheTarget[1]][matcheTarget[2]].name = targetName;
		successCallback();
	}, errorCallback);
});

chrome.fileSystemProvider.onReadFileRequested.addListener(function(options, successCallback, errorCallback) {
	chrome.fileSystemProvider.get(options.fileSystemId, function(fileSystem) {
		fileSystem.openedFiles.forEach(function(file) {
			if (file.openRequestId == options.openRequestId) {
				var length = options.length;

				run_ftp(options, ["REST " + options.offset + "\r\n", "PASV\r\n", "RETR " + file.filePath + "\r\n"], function() {}, errorCallback, function(data) {
					if (length == 0)
						return false;
					
					if (data.byteLength < length) {
						length -= data.byteLength;
						successCallback(data, true);
						return false;
					}
					else if (data.byteLength == length) {
						length = 0;
						successCallback(data, false);
						return true;
					} else {
						length = 0;
						successCallback(data.slice(0, length - 1), false);
						return true;
					}
				});
				return;
			}
		});
	});
});

chrome.fileSystemProvider.onCreateDirectoryRequested.addListener(function(options, successCallback, errorCallback) {
	run_ftp(options, ["MKD " + options.entryPath + "\r\n"], function() {
		var matches = splitPath(options.entryPath);

		ftp_entries[options.fileSystemId][matches[1]][matches[2]] = {
			isDirectory: true,
			name: matches[2],
			size: 2,
			modificationTime: new Date()
		};
		successCallback();
	}, errorCallback);
});

chrome.fileSystemProvider.onDeleteEntryRequested.addListener(function(options, successCallback, errorCallback) {
	run_ftp(options, ["DELE " + options.entryPath + "\r\n"], function() {
		var matches = splitPath(options.entryPath);

		delete ftp_entries[options.fileSystemId][matches[1]][matches[2]];
		successCallback();
	}, errorCallback);
});

chrome.fileSystemProvider.onCreateFileRequested.addListener(function(options, successCallback, errorCallback) {
	options["data"] = new ArrayBuffer(0);
	run_ftp(options, ["PASV\r\n", "STOR " + options.filePath + "\r\n"], function() {
		var matches = splitPath.exec(options.filePath);

		ftp_entries[options.fileSystemId][matches[1]][matches[2]] = {
			isDirectory: false,
			name: options.filePath.substring(matches[2]),
			size: 0,
			modificationTime: new Date()
		};
		successCallback();
	}, errorCallback);
});

chrome.fileSystemProvider.onWriteFileRequested.addListener(function(options, successCallback, errorCallback) {
	chrome.fileSystemProvider.get(options.fileSystemId, function(fileSystem) {
		fileSystem.openedFiles.forEach(function(file) {
			if (file.openRequestId == options.openRequestId) {
				run_ftp(options, ["REST " + options.offset + "\r\n", "PASV\r\n", "STOR " + file.filePath + "\r\n"], successCallback, errorCallback);
				return;
			}
		});
	});
});

chrome.fileSystemProvider.onMountRequested.addListener(function(successCallback, errorCallback) {
	chrome.app.window.create('window.html', {
		'outerBounds': {
			'width': 400,
			'height': 500
		}
	});

	successCallback();
});

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
	var fileSystemId = request.user + "@" + request.address + ":" + request.port;
	
	if (ftp_entries[fileSystemId]) {
		sendResponse({message: "Already Mounted."});
		return;
	}

	run_ftp({
		fileSystemId: fileSystemId,
		password: request.password
	}, ["SYST\r\n"], function() {
		chrome.fileSystemProvider.mount({
			fileSystemId: fileSystemId,
			displayName: request.address,
			writable: true,
			openedFilesLimit: 0
		}, function() {
			ftp_entries[fileSystemId] = {
				password: request.password
			};
			
			sendResponse({message: "OK"});
		});
	}, function(error) {
		switch(error) {
			case "INVALID_URL":
				sendResponse({message: "Invalid URL"});
				break;
			case "ACCESS_DENIED":
				sendResponse({message: "Access Denied"});
				break;
			case "SECURITY":
				sendResponse({message: "Cannot Log-in"});
				break;
		}
	});
	sendResponse({message: "OK"});
});	
