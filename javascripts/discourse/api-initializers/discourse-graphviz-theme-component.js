import { cancel, later } from "@ember/runloop";
import { Promise } from "rsvp";
import { apiInitializer } from "discourse/lib/api";

const webWorkerUrl = settings.theme_uploads_local.graphviz_worker;
let webWorker;
const graphvizURL = settings.theme_uploads.graphviz;
let laterHeightHandler;

async function applyGraphviz(element, key = "composer") {
  let graphs = element.querySelectorAll("pre[data-code-wrap=graphviz]");

  if (!graphs.length) {
    return;
  }

  graphs.forEach((graphviz) => {
    if (graphviz.dataset.processed) {
      return;
    }

    const spinner = document.createElement("div");
    spinner.classList.add("spinner");

    if (graphviz.dataset.codeHeight && key !== "composer") {
      graphviz.style.height = `${graphviz.dataset.codeHeight}px`;
    }

    later(() => {
      if (!graphviz.dataset.processed) {
        graphviz.append(spinner);
      }
    }, 2000);
  });

  graphs = element.querySelectorAll("pre[data-code-wrap=graphviz]");
  graphs.forEach(async (graphviz, index) => {
    if (graphviz.dataset.processed) {
      return;
    }

    const code = graphviz.querySelector("code");
    if (!code) {
      graphviz.dataset.processed = "true";
      return;
    }

    let cooked = await cookGraphviz(
      code.innerText,
      graphviz.dataset.codeEngine
    );
    graphviz.dataset.processed = "true";
    graphviz.innerHTML = cooked;

    if (key === "composer") {
      cancel(laterHeightHandler);
      laterHeightHandler = later(updateMarkdownHeight, graphviz, index, 1000);
    }
  });
}

let messageSeq = 0;
let resolvers = {};

async function cookGraphviz(text, engine = "dot") {
  let seq = messageSeq++;

  if (!webWorker) {
    webWorker = new Worker(webWorkerUrl);
    webWorker.postMessage(["graphvizURL", graphvizURL]);
    webWorker.onmessage = function (e) {
      if (e.data.type === "results") {
        resolvers[e.data.seq](e.data.svg);
        delete resolvers[e.data.seq];
      }
    };
  }

  webWorker.postMessage([seq, text, engine]);

  let promise = new Promise((resolve) => {
    resolvers[seq] = resolve;
  });

  return promise;
}

function updateMarkdownHeight(graphviz, index) {
  // +1 for rounding errors
  const height = parseInt(graphviz.getBoundingClientRect().height, 10) + 1;
  const calculatedHeight = parseInt(graphviz.dataset.calculatedHeight, 10);

  if (height === 0 || height === calculatedHeight) {
    return;
  }

  graphviz.dataset.calculatedHeight = height;
  // TODO: need to use API here
  const composer = document.getElementsByClassName("d-editor-input")[0];
  const split = composer.value.split("\n");

  let n = 0;
  for (let i = 0; i < split.length; i++) {
    if (split[i].match(/```graphviz/)) {
      if (n === index) {
        // transform existing params into an object for easier manipulation
        const rawParams = split[i]
          .match(/```graphviz ?(.*)/)[1]
          ?.split(",")
          .filter(Boolean)
          .reduce((map, param) => {
            const [key, value] = param.split("=");
            map[key] = value;
            return map;
          }, {});

        // always replace existing height by new value
        rawParams.height = height;

        split[i] =
          "```graphviz " +
          Object.keys(rawParams)
            .map((key) => `${key}=${rawParams[key]}`)
            .join(",");
      }
      n += 1;
    }
  }

  let joined = split.join("\n");

  if (joined !== composer.value) {
    let restorePosStart = composer.selectionStart;
    let restorePosEnd = composer.selectionEnd;

    composer.value = joined;

    if (restorePosStart) {
      composer.selectionStart = restorePosStart;
      composer.selectionEnd = restorePosEnd;
    }
  }
}

export default apiInitializer("1.13.0", (api) => {
  // this is a hack as applySurround expects a top level
  // composer key, not possible from a theme
  window.I18n.translations[
    window.I18n.locale
  ].js.composer.graphviz_sample = `graph {
  a -- b;
}`;

  api.addComposerToolbarPopupMenuOption({
    icon: "project-diagram",
    label: themePrefix("insert_graphviz_sample"),
    action: (toolbarEvent) => {
      toolbarEvent.applySurround(
        "\n```graphviz engine=dot\n",
        "\n```\n",
        "graphviz_sample",
        { multiline: false }
      );
    },
  });

  if (api.decorateChatMessage) {
    api.decorateChatMessage((element) => {
      applyGraphviz(element, `chat_message_${element.id}`);
    });
  }

  api.decorateCookedElement(
    async (elem, helper) => {
      const id = helper ? `post_${helper.getModel().id}` : "composer";
      applyGraphviz(elem, id);
    },
    { id: "discourse-graphviz" }
  );
});
