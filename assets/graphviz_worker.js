let loadedGraphviz;

function loadWasm(graphvizURL) {
  // eslint-disable-next-line no-undef
  importScripts(graphvizURL);

  const hpccWasm = self["@hpcc-js/wasm"];
  hpccWasm.Graphviz.load().then((graphviz) => {
    loadedGraphviz = graphviz;
  });
}

function messageFunction(e) {
  if (e.data[0] === "graphvizURL") {
    loadWasm(e.data[1]);
    return;
  }
  if (!loadedGraphviz) {
    // waiting to load...
    setTimeout(() => {
      messageFunction(e);
    }, 50);
    return;
  }

  self.postMessage({
    type: "results",
    seq: e.data[0],
    svg: loadedGraphviz.layout(e.data[1], "svg", e.data[2]),
  });
}

// web worker magic function, no definition needed
onmessage = messageFunction;
