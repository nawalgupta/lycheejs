
lychee.define('strainer.flow.Check').requires([
	'lychee.Stash',
	'lychee.event.Queue',
	'strainer.api.PARSER',
	'strainer.plugin.API',
	'strainer.plugin.ESLINT'
]).includes([
	'lychee.event.Flow'
]).exports(function(lychee, global, attachments) {

	const _plugin    = {
		API:    lychee.import('strainer.plugin.API'),
		ESLINT: lychee.import('strainer.plugin.ESLINT')
	};
	const _Flow      = lychee.import('lychee.event.Flow');
	const _Queue     = lychee.import('lychee.event.Queue');
	const _Stash     = lychee.import('lychee.Stash');
	const _PARSER    = lychee.import('strainer.api.PARSER');
	const _PLATFORMS = lychee.PLATFORMS;
	const _STASH     = new _Stash({
		type: _Stash.TYPE.persistent
	});



	/*
	 * HELPERS
	 */

	const _resolve = function(identifier) {

		let pointer   = this;
		let namespace = identifier.split('.');
		let id        = namespace.pop();

		for (let n = 0, nl = namespace.length; n < nl; n++) {

			let name = namespace[n];

			if (pointer[name] === undefined) {
				pointer[name] = {};
			}

			pointer = pointer[name];

		}


		let check = id.toLowerCase();
		if (check === id) {

			if (pointer[id] === undefined) {
				pointer[id] = {};
			}

			return pointer[id];

		} else {

			if (pointer[id] !== undefined) {
				return pointer[id];
			}

		}


		return null;

	};

	const _walk_directory = function(files, node, path) {

		if (node instanceof Array) {

			if (node.includes('js')) {
				files.push(path + '.js');
			}

		} else if (node instanceof Object) {

			for (let child in node) {
				_walk_directory(files, node[child], path + '/' + child);
			}

		}

	};

	const _trace_dependencies = function() {

		let configs      = this.configs;
		let dependencies = [];

		configs.filter(function(config) {
			return config !== null;
		}).map(function(config) {
			return config.buffer.source.header || { requires: [], includes: [] };
		}).forEach(function(header) {

			if (header.requires.length > 0) {

				header.requires.forEach(function(id) {

					if (dependencies.indexOf(id) === -1) {
						dependencies.push(id);
					}

				});

			}

			if (header.includes.length > 0) {

				header.includes.forEach(function(id) {

					if (dependencies.indexOf(id) === -1) {
						dependencies.push(id);
					}

				});

			}

		});

		dependencies = dependencies.filter(function(identifier) {

			let config = configs.find(function(other) {

				let buffer = other.buffer;
				if (buffer !== null) {
					return identifier === buffer.source.header.identifier;
				}

				return false;

			}) || null;

			if (config !== null) {
				return false;
			}

			return true;

		});

		return dependencies;

	};

	const _trace_memory = function(memory, chunk, scope) {

		scope = scope instanceof Object ? scope : null;


		let values = [];


		if (chunk.startsWith('_')) {

			let tmp      = chunk.split('.');
			let variable = memory[tmp.shift()];

			if (variable !== undefined) {

				if (variable.value !== undefined) {

					let identifier = variable.value.reference;
					let config     = this.configs.find(function(other) {

						if (other !== null) {

							let buffer = other.buffer;
							if (buffer !== null) {
								return identifier === buffer.source.header.identifier;
							}

						}

						return false;

					}) || null;

					if (config !== null) {

						let memory = config.buffer.source.memory;
						let result = config.buffer.source.result;
						let check  = tmp.shift();

						if (check === 'prototype') {

							let mid    = tmp.shift();
							let method = _trace_method.call(this, mid, config);
							if (method !== null) {

								if (method.values.length === 1) {

									let value = method.values[0];
									if (value.type === 'undefined' && value.chunk !== undefined) {
										return _trace_memory.call(this, memory, value.chunk, scope);
									} else {
										values.push(value);
									}

								} else {

									for (let v = 0, vl = method.values.length; v < vl; v++) {
										values.push(method.values[v]);
									}

								}

							}

						} else if (check === check.toUpperCase()) {

							let enam = result.enums[check] || null;
							if (enam !== null) {

								let name  = tmp.shift();
								let value = enam.values.find(function(val) {
									return val.name === name;
								}) || null;

								if (value !== null) {

									values.push({
										chunk: chunk,
										type:  value.value.type,
										value: value.value.value
									});

								}

							}

						}

					}

				} else if (variable.values !== undefined) {

					let check = tmp.shift();
					if (check.startsWith('call(') || check.startsWith('(')) {

						for (let v = 0, vl = variable.values.length; v < vl; v++) {
							values.push(variable.values[v]);
						}

					}

				}

			}

		} else if (chunk.startsWith('this.')) {

			let path    = chunk.split('.').slice(1);
			let pointer = scope[path[0]] || null;
			if (pointer !== null) {

				if (pointer.value !== undefined && pointer.value.type === 'Object') {

					let tmp = pointer.value.value;
					if (tmp instanceof Object) {

						for (let p = 1, pl = path.length; p < pl; p++) {

							let prop = path[p];
							if (
								/^([A-Za-z0-9_]+)$/g.test(prop)
								&& pointer.value !== undefined
								&& pointer.value.type === 'Object'
							) {

								pointer = _PARSER.detect(pointer.value.value[prop]);

							} else {

								pointer = null;
								break;

							}

						}

					}

				}


				if (pointer !== null) {
					values.push(pointer);
				}

			}

		}


		return values;

	};

	const _trace_method = function(mid, config) {

		let configs = this.configs;
		let header  = config.buffer.source.header;
		let result  = config.buffer.source.result;


		let found = null;

		if (result.methods[mid] !== undefined) {

			found = result.methods[mid];

		} else {

			for (let i = 0, il = header.includes.length; i < il; i++) {

				let identifier = header.includes[i];
				let definition = configs.find(function(other) {

					let buffer = other.buffer;
					if (buffer !== null) {
						return identifier === buffer.source.header.identifier;
					}

					return false;

				}) || null;

				if (definition !== null) {

					let check = _trace_method.call(this, mid, definition);
					if (check !== null) {
						found = check;
						break;
					}

				}

			}

		}

		return found;

	};

	const _package_files = function(json, type) {

		let files = [];


		if (json !== null) {

			let root = json[type].files || null;
			if (root !== null) {
				_walk_directory(files, root, '');
			}


			files = files.map(function(value) {
				return value.substr(1);
			}).filter(function(value) {
				return value.includes('__') === false;
			}).sort();

		}


		return files;

	};

	const _render_statistics = function(id, statistics) {

		let types = Object.keys(statistics);
		if (types.length > 0) {

			let is_valid = false;

			types.forEach(function(type) {

				let names = Object.keys(statistics[type]);
				if (names.length > 0) {

					// XXX: This will log the headline only when
					// it contains an actual statistics report
					if (is_valid === false) {
						console.log('strainer: SIMULATE-REVIEWS of "' + id + '":');
						is_valid = true;
					}


					names.forEach(function(name) {

						let obj   = statistics[type][name];
						let title = name;
						if (type === 'enums') {
							title = '#' + name;
						} else if (type === 'events') {
							title = '@' + name;
						} else if (type === 'methods') {
							title = name + '()';
						}


						let info  = title + ': ' + obj.results.ok + '/' + obj.results.all;

						if (obj._expect > 0) {
							info += ' (' + obj._expect + ' incomplete)';
						}

						if (obj.results.ok < obj.results.all || obj._expect > 0) {
							console.error('strainer: \t' + info);
						} else {
							console.log('strainer: \t' + info);
						}

					});

				}

			});

		}

	};

	const _simulate = function(settings, oncomplete) {

		console.log('strainer: SIMULATE-REVIEWS "' + settings.id + '"');


		let simulation = new lychee.Simulation(settings);


		lychee.setEnvironment(settings.environment);
		lychee.setSimulation(simulation);


		lychee.init(simulation, {
		}, function(sandboxes) {

			let remaining      = 0;
			let specifications = Object.keys(simulation.specifications);
			if (specifications.length > 0) {

				specifications.map(function(sid) {

					return {
						id:      sid,
						sandbox: _resolve.call(sandboxes, sid)
					};

				}).filter(function(entry) {

					let sandbox = entry.sandbox || null;
					if (sandbox !== null && typeof sandbox.evaluate === 'function') {
						return true;
					}

					return false;

				}).forEach(function(entry) {

					remaining++;

					entry.sandbox.evaluate(function(statistics) {
						_render_statistics(entry.id, statistics);
						remaining--;
					});

				});

				setInterval(function() {

					if (remaining === 0) {
						oncomplete(true);
					}

				}, 250);

			} else {

				oncomplete(true);

			}

		});

	};



	/*
	 * IMPLEMENTATION
	 */

	const Composite = function(data) {

		let states = Object.assign({}, data);


		this.configs  = [];
		this.errors   = [];
		this.reviews  = [];
		this.sources  = [];
		this.sandbox  = '';
		this.settings = {};
		this.stash    = new _Stash({
			type: _Stash.TYPE.persistent
		});

		this.__pkg         = null;
		this.__packages    = {};
		this.__simulations = [];


		this.setSandbox(states.sandbox);
		this.setSettings(states.settings);


		_Flow.call(this);

		states = null;



		/*
		 * INITIALIZATION
		 */

		this.bind('read-sources', function(oncomplete) {

			let that    = this;
			let project = this.settings.project;
			let sandbox = this.sandbox;
			let stash   = this.stash;

			if (sandbox !== '' && stash !== null) {

				console.log('strainer: READ-SOURCES ' + project);

				this.__pkg        = new Config(sandbox + '/lychee.pkg');
				this.__pkg.onload = function(result) {

					if (result === true) {

						let sources = _package_files(this.buffer, 'source');
						if (sources.length > 0) {

							stash.bind('batch', function(type, assets) {

								this.sources = assets.filter(function(asset) {
									return asset !== null;
								});

								oncomplete(true);

							}, that, true);

							stash.batch('read', sources.map(function(value) {
								return sandbox + '/source/' + value;
							}));

						} else {

							oncomplete(true);

						}

					} else {

						oncomplete(false);

					}

				};

				this.__pkg.load();

			} else {

				oncomplete(false);

			}

		}, this);

		this.bind('read-reviews', function(oncomplete) {

			let that    = this;
			let project = this.settings.project;
			let sandbox = this.sandbox;
			let stash   = this.stash;

			if (sandbox !== '' && stash !== null) {

				console.log('strainer: READ-REVIEWS ' + project);

				let reviews = _package_files(this.__pkg.buffer, 'review');
				if (reviews.length > 0) {

					stash.bind('batch', function(type, assets) {

						this.reviews = assets.filter(function(asset) {
							return asset !== null;
						});

						oncomplete(true);

					}, that, true);

					stash.batch('read', reviews.map(function(value) {
						return sandbox + '/review/' + value;
					}));

				} else {

					oncomplete(true);

				}

			} else {

				oncomplete(false);

			}

		}, this);

		this.bind('lint-sources', function(oncomplete) {

			let eslint  = _plugin.ESLINT || null;
			let errors  = this.errors;
			let project = this.settings.project;

			if (eslint !== null) {

				console.log('strainer: LINT-SOURCES ' + project);

				this.sources.forEach(function(asset) {

					let eslint_report  = _plugin.ESLINT.check(asset);
					let eslint_unfixed = _plugin.ESLINT.fix(asset, eslint_report);

					if (eslint_unfixed.length > 0) {

						eslint_unfixed.map(function(err) {

							return {
								url:     asset.url,
								rule:    err.ruleId  || 'parser-error',
								line:    err.line    || 0,
								column:  err.column  || 0,
								message: err.message || ''
							};

						}).forEach(function(err) {

							errors.push(err);

						});

					}

				});


				oncomplete(true);

			} else {

				oncomplete(false);

			}

		}, this);

		this.bind('lint-reviews', function(oncomplete) {

			let eslint  = _plugin.ESLINT || null;
			let errors  = this.errors;
			let project = this.settings.project;

			if (eslint !== null) {

				console.log('strainer: LINT-REVIEWS ' + project);

				this.reviews.forEach(function(asset) {

					let eslint_report  = _plugin.ESLINT.check(asset);
					let eslint_unfixed = _plugin.ESLINT.fix(asset, eslint_report);

					if (eslint_unfixed.length > 0) {

						eslint_unfixed.map(function(err) {

							return {
								url:     asset.url,
								rule:    err.ruleId  || 'parser-error',
								line:    err.line    || 0,
								column:  err.column  || 0,
								message: err.message || ''
							};

						}).forEach(function(err) {

							errors.push(err);

						});

					}

				});


				oncomplete(true);

			} else {

				oncomplete(false);

			}

		}, this);

		this.bind('check-sources', function(oncomplete) {

			let api     = _plugin.API || null;
			let errors  = this.errors;
			let project = this.settings.project;

			if (api !== null) {

				console.log('strainer: CHECK-SOURCES ' + project);


				this.configs = this.sources.map(function(asset) {

					let result      = [];
					let api_report  = _plugin.API.check(asset);
					let api_unfixed = _plugin.API.fix(asset, api_report);

					if (api_report !== null) {

						if (api_unfixed.length > 0) {

							api_unfixed.forEach(function(err) {

								result.push(err);
								errors.push(err);

							});

							api_report.errors = result;

						}


						if (asset.url.includes('/source/')) {

							let url    = asset.url.replace('/source/', '/api/').replace(/\.js$/, '.json');
							let config = new lychee.Asset(url, 'json', true);
							if (config !== null) {

								config.buffer = {
									errors: api_report.errors,
									source: {
										header: api_report.header,
										memory: api_report.memory,
										result: api_report.result
									},
									review: null
								};

							}

							return config;

						}

					}


					return null;

				});


				oncomplete(true);

			} else {

				oncomplete(false);

			}

		}, this);

		this.bind('check-reviews', function(oncomplete) {

			let api     = _plugin.API || null;
			let configs = this.configs;
			let errors  = this.errors;
			let project = this.settings.project;

			if (api !== null) {

				console.log('strainer: CHECK-REVIEWS ' + project);

				this.reviews.map(function(asset) {

					let result      = [];
					let api_report  = _plugin.API.check(asset);
					let api_unfixed = _plugin.API.fix(asset, api_report);

					if (api_report !== null) {

						if (api_unfixed.length > 0) {

							api_unfixed.forEach(function(err) {

								result.push(err);
								errors.push(err);

							});

							api_report.errors = result;

						}

					}


					if (asset.url.includes('/review/')) {

						let url    = asset.url.replace('/review/', '/api/').replace(/\.js$/, '.json');
						let config = configs.find(function(other) {
							return other.url === url;
						}) || null;

						if (config !== null) {

							config.buffer.review = {
								header: api_report.header,
								memory: api_report.memory,
								result: api_report.result
							};

						}

					}

				});

			}

			oncomplete(true);

		}, this);

		this.bind('trace-package', function(oncomplete) {

			let errors  = this.errors;
			let pkg     = this.__pkg;
			let project = this.settings.project;
			let sandbox = this.sandbox;

			if (pkg !== null) {

				console.log('strainer: TRACE-PACKAGE ' + project);


				let packages     = this.__packages;
				let environments = pkg.buffer.build.environments || null;
				if (environments !== null) {

					for (let id in environments) {

						let pkgs = environments[id].packages || null;
						if (pkgs instanceof Array) {

							errors.push({
								url:     pkg.url,
								rule:    'pkg-error',
								line:    0,
								column:  0,
								message: 'Invalid settings for Environment "' + id + '" (Invalid packages).'
							});

						} else if (pkgs instanceof Object) {

							for (let ns in pkgs) {

								let url = pkgs[ns];
								if (url === './lychee.pkg') {
									url = sandbox + '/lychee.pkg';
								}


								if (packages[ns] === undefined) {

									packages[ns] = new lychee.Package({
										id:  ns,
										url: url
									});

								} else if (packages[ns].url !== url) {

									errors.push({
										url:     pkg.url,
										rule:    'pkg-error',
										line:    0,
										column:  0,
										message: 'Invalid settings for Package "' + ns + '" in Environment "' + id + '" (Invalid url).'
									});

								}

							}

						}

					}

				}


				if (packages['lychee'] === undefined) {
					packages['lychee'] = new lychee.Package({
						id:  'lychee',
						url: '/libraries/lychee/lychee.pkg'
					});
				}


				let interval_end = Date.now() + 1000;
				let interval_id  = setInterval(function() {

					let all_ready = true;

					for (let ns in packages) {

						let pkg = packages[ns];
						if (pkg.config === null) {
							all_ready = false;
							break;
						}

					}


					if (all_ready === true) {

						clearInterval(interval_id);
						oncomplete(true);

					} else if (Date.now() > interval_end) {

						for (let ns in packages) {

							let pkg = packages[ns];
							if (pkg.config === null) {

								errors.push({
									url:     pkg.url,
									rule:    'pkg-error',
									line:    0,
									column:  0,
									message: 'Invalid Package "' + ns + '".'
								});

							}

						}

						clearInterval(interval_id);
						oncomplete(true);

					}

				}, 100);

			} else {

				oncomplete(false);

			}

		}, this);


		this.bind('trace-includes', function(oncomplete) {

			let packages = this.__packages;
			let project  = this.settings.project;
			let stash    = this.stash;

			if (stash !== null) {

				let dependencies = _trace_dependencies.call(this);
				if (dependencies.length > 0) {

					console.log('strainer: TRACE-INCLUDES ' + project + ' (' + dependencies.length + ')');


					let candidates = [];

					dependencies.forEach(function(identifier) {

						let ns  = identifier.split('.')[0];
						let id  = identifier.split('.').slice(1).join('.');
						let pkg = packages[ns] || null;
						if (pkg !== null) {

							let prefix = pkg.url.split('/').slice(0, -1).join('/');
							let found  = false;

							let resolved = pkg.resolve(id, null);
							if (resolved.length > 0) {
								candidates.push(prefix + '/api/' + resolved[0] + '.json');
								found = true;
							}


							if (found === false) {

								resolved = pkg.resolve(id, {
									platforms: _PLATFORMS
								});

								if (resolved.length > 0) {

									resolved.forEach(function(path) {
										candidates.push(prefix + '/api/' + path + '.json');
									});

								}

							}

						}

					});


					if (candidates.length > 0) {

						stash.bind('batch', function(type, assets) {

							for (let a = 0, al = assets.length; a < al; a++) {

								let asset = assets[a];
								if (asset !== null && asset.buffer !== null) {
									this.configs.push(asset);
								}

							}

							setTimeout(function() {

								let unknown_includes = _trace_dependencies.call(this).filter(function(dependency) {
									return dependencies.includes(dependency) === false;
								});

								if (unknown_includes.length > 0) {

									this.trigger('trace-includes', [ oncomplete ]);

								} else {

									oncomplete(true);

								}

							}.bind(this), 100);

						}, this, true);

						stash.batch('read', candidates);

					} else {

						oncomplete(true);

					}

				} else {

					oncomplete(true);

				}

			} else {

				oncomplete(false);

			}

		}, this);

		this.bind('trace-configs', function(oncomplete) {

			let that    = this;
			let errors  = this.errors;
			let configs = this.configs;
			let project = this.settings.project;

			if (configs.length > 0) {

				console.log('strainer: TRACE-CONFIGS ' + project);


				configs.filter(function(config) {
					return config !== null;
				}).forEach(function(config) {

					let result     = config.buffer.source.result;
					let memory     = config.buffer.source.memory;
					let methods    = result.methods    || {};
					let properties = result.properties || {};
					let scope      = properties;

					for (let pid in properties) {

						let value = properties[pid].value;
						if (value.type === 'undefined' && value.chunk !== undefined) {

							let references = _trace_memory.call(that, memory, value.chunk, scope);
							if (references.length === 1) {

								properties[pid].value = references[0];


								let error = config.buffer.errors.find(function(err) {
									return err.rule === 'unguessable-property-value' && err.message.includes('"' + pid + '"');
								}) || null;

								if (error !== null) {

									let e0 = errors.indexOf(error);
									let e1 = config.buffer.errors.indexOf(error);

									if (e0 !== -1) {
										errors.splice(e0, 1);
									}

									if (e1 !== -1) {
										config.buffer.errors.splice(e1, 1);
									}

								}

							}

						}

					}


					for (let mid in methods) {

						let values = methods[mid].values;
						if (values.length > 0) {

							for (let v = 0, vl = values.length; v < vl; v++) {

								let value = values[v];
								if (value.type === 'undefined' && value.chunk !== undefined) {

									let references = _trace_memory.call(that, memory, value.chunk, scope);
									if (references.length > 0) {

										values.splice(v, 1);
										vl--;
										v--;

										for (let r = 0, rl = references.length; r < rl; r++) {

											let reference = references[r];
											if (values.indexOf(reference) === -1) {
												values.push(reference);
											}

										}


										let error = config.buffer.errors.find(function(err) {
											return err.rule === 'unguessable-return-value' && err.message.includes('"' + mid + '()"');
										}) || null;

										if (error !== null) {

											let e0 = errors.indexOf(error);
											let e1 = config.buffer.errors.indexOf(error);

											if (e0 !== -1) {
												errors.splice(e0, 1);
											}

											if (e1 !== -1) {
												config.buffer.errors.splice(e1, 1);
											}

										}

									}

								}

							}

						}

					}

				});

			}


			oncomplete(true);

		}, this);

		this.bind('clean-includes', function(oncomplete) {

			let configs = this.configs;
			let project = this.settings.project;
			let sandbox = this.sandbox;


			let cleaned_includes = 0;

			for (let c = 0, cl = configs.length; c < cl; c++) {

				let config = configs[c];
				if (config !== null) {

					if (config.url.startsWith(sandbox) === false) {

						cleaned_includes++;
						configs.splice(c, 1);
						cl--;
						c--;

					}

				}

			}

			console.log('strainer: CLEAN-INCLUDES ' + project + ' (' + cleaned_includes + ')');


			oncomplete(true);

		}, this);

		this.bind('simulate-reviews', function(oncomplete) {

			let cache   = this.__simulations;
			let pkg     = this.__pkg;
			let project = this.settings.project;
			let sandbox = this.sandbox;

			if (pkg !== null) {

				console.log('strainer: SIMULATE-REVIEWS ' + project);


				let simulations = pkg.buffer.review.simulations || null;
				if (simulations !== null) {

					for (let id in simulations) {

						let raw      = simulations[id];
						let settings = {
							id: id
						};


						let env = raw.environment || null;
						if (env !== null) {

							let pkgs = raw.environment.packages;
							if (pkgs instanceof Object) {

								for (let ns in pkgs) {

									let url = pkgs[ns];
									if (url === './lychee.pkg') {
										url = sandbox + '/lychee.pkg';
									}

									pkgs[ns] = url;

								}

							}


							settings.environment = new lychee.Environment(raw.environment);

							let target = raw.target || null;
							if (target !== null) {
								settings.target = target;
								cache.push(settings);
							}

						}

					}

				}

			}


			if (cache.length > 0) {

				let env   = lychee.environment;
				let queue = new _Queue();

				queue.bind('update', _simulate, this);

				queue.bind('complete', function() {

					lychee.setEnvironment(env);
					lychee.setSimulation(null);

					oncomplete(true);

				}, this);

				queue.bind('error', function() {

					lychee.setEnvironment(env);
					lychee.setSimulation(null);

					oncomplete(true);

				}, this);

				cache.forEach(function(entry) {
					queue.then(entry);
				});

				queue.init();

			} else {

				oncomplete(true);

			}

		}, this);

		this.bind('write-sources', function(oncomplete) {

			let project = this.settings.project;
			let stash   = this.stash;

			if (project !== null && stash !== null) {

				console.log('strainer: WRITE-SOURCES ' + project);


				let sources = this.sources.filter(function(code, c) {
					return code._MODIFIED === true;
				});

				if (sources.length > 0) {

					stash.bind('batch', function(type, assets) {

						if (assets.length === sources.length) {
							oncomplete(true);
						} else {
							oncomplete(false);
						}

					}, this, true);

					stash.batch('write', sources.map(function(asset) {
						return asset.url;
					}), sources);

				} else {

					oncomplete(true);

				}

			} else {

				oncomplete(false);

			}

		}, this);

		this.bind('write-reviews', function(oncomplete) {

			let project = this.settings.project;
			let stash   = this.stash;

			if (project !== null && stash !== null) {

				console.log('strainer: WRITE-REVIEWS ' + project);


				let reviews = this.reviews.filter(function(code, c) {
					return code._MODIFIED === true;
				});

				if (reviews.length > 0) {

					stash.bind('batch', function(type, assets) {

						if (assets.length === reviews.length) {
							oncomplete(true);
						} else {
							oncomplete(false);
						}

					}, this, true);

					stash.batch('write', reviews.map(function(asset) {
						return asset.url;
					}), reviews);

				} else {

					oncomplete(true);

				}

			} else {

				oncomplete(false);

			}

		}, this);

		this.bind('write-configs', function(oncomplete) {

			let project = this.settings.project;
			let stash   = this.stash;

			if (project !== null && stash !== null) {

				console.log('strainer: WRITE-CONFIGS ' + project);


				let configs = this.configs.filter(function(config) {
					return config !== null;
				});

				if (configs.length > 0) {

					stash.bind('batch', function(type, assets) {

						if (assets.length === configs.length) {
							oncomplete(true);
						} else {
							oncomplete(false);
						}

					}, this, true);

					stash.batch('write', configs.map(function(config) {
						return config.url;
					}), configs);

				} else {

					oncomplete(true);

				}

			} else {

				oncomplete(false);

			}

		}, this);

		this.bind('write-package', function(oncomplete) {

			let project = this.settings.project;
			let stash   = this.stash;

			if (project !== null && stash !== null) {

				console.log('strainer: WRITE-PACKAGE ' + project);


				let configs = this.configs.filter(function(config) {
					return config !== null;
				});


				if (configs.length > 0) {

					let index = stash.read(project + '/api/strainer.pkg');

					index.onload = function(result) {

						if (result === false) {
							this.buffer = {};
						}


						let buffer = this.buffer;

						for (let c = 0, cl = configs.length; c < cl; c++) {

							let config     = configs[c];
							let identifier = config.buffer.source.header.identifier;
							let result     = config.buffer.source.result;


							let knowledge = {};

							knowledge.states     = Object.keys(result.states);
							knowledge.properties = Object.keys(result.properties).map(function(pid) {
								return [ pid, result.properties[pid].hash ];
							});
							knowledge.enums      = Object.keys(result.enums);
							knowledge.events     = Object.keys(result.events).map(function(eid) {
								return [ eid, result.events[eid].hash ];
							});
							knowledge.methods    = Object.keys(result.methods).map(function(mid) {
								return [ mid, result.methods[mid].hash ];
							});


							buffer[config.url] = {
								identifier: identifier,
								timestamp:  Date.now(),
								knowledge:  knowledge
							};

						}


						stash.write(index.url, index);
						stash.sync();

						oncomplete(true);

					};

					index.load();

				} else {

					oncomplete(true);

				}

			} else {

				oncomplete(false);

			}

		}, this);



		/*
		 * FLOW
		 */

		this.then('read-sources');
		this.then('read-reviews');

		this.then('lint-sources');
		this.then('lint-reviews');

		this.then('check-sources');
		this.then('check-reviews');

		this.then('trace-package');
		this.then('trace-includes');
		this.then('trace-configs');
		this.then('clean-includes');

		this.then('simulate-reviews');

		this.then('write-sources');
		this.then('write-reviews');
		this.then('write-configs');
		this.then('write-package');

	};


	Composite.prototype = {

		/*
		 * ENTITY API
		 */

		deserialize: function(blob) {

			if (blob.sources instanceof Array) {

				let sources = [];

				for (let bc1 = 0, bc1l = blob.sources.length; bc1 < bc1l; bc1++) {
					sources.push(lychee.deserialize(blob.sources[bc1]));
				}

				if (sources.length > 0) {

					this.sources = sources.filter(function(asset) {
						return asset !== null;
					});

				}

			}


			if (blob.configs instanceof Array) {

				let configs = [];

				for (let bc2 = 0, bc2l = blob.configs.length; bc2 < bc2l; bc2++) {
					configs.push(lychee.deserialize(blob.configs[bc2]));
				}

				if (configs.length > 0) {

					this.configs = configs.filter(function(asset) {
						return asset !== null;
					});

				}

			}


			let stash = lychee.deserialize(blob.stash);
			if (stash !== null) {
				this.stash = stash;
			}

		},

		serialize: function() {

			let data = _Flow.prototype.serialize.call(this);
			data['constructor'] = 'strainer.flow.Check';


			let states = data['arguments'][0] || {};
			let blob   = data['blob'] || {};


			if (this.sandbox !== '')                   states.sandbox  = this.sandbox;
			if (Object.keys(this.settings).length > 0) states.settings = this.settings;


			if (this.stash !== null)     blob.stash   = lychee.serialize(this.stash);
			if (this.configs.length > 0) blob.configs = this.configs.map(lychee.serialize);
			if (this.reviews.length > 0) blob.reviews = this.reviews.map(lychee.serialize);
			if (this.sources.length > 0) blob.sources = this.sources.map(lychee.serialize);


			data['arguments'][0] = states;
			data['blob']         = Object.keys(blob).length > 0 ? blob : null;


			return data;

		},



		/*
		 * CUSTOM API
		 */

		setSandbox: function(sandbox) {

			sandbox = typeof sandbox === 'string' ? sandbox : null;


			if (sandbox !== null) {

				this.sandbox = sandbox;


				return true;

			}


			return false;

		},

		setSettings: function(settings) {

			settings = settings instanceof Object ? settings : null;


			if (settings !== null) {

				this.settings = settings;

				return true;

			}


			return false;

		}

	};


	return Composite;

});

