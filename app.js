// ===== 进度存取（localStorage：存在浏览器本地） =====
    const PROGRESS_PREFIX = "skill-tree-progress";
    const LAST_PACK_KEY = "skill-tree-last-pack";
    const LEGACY_PHYSICS_KEY = "skill-tree-progress-v1"; // 旧版单一进度的备份键

    let allSkills = []; // 拍平后的所有技能，方便统计
    let totalExp = 0;
    let completedNames = new Set(); // 已掌握的技能名
    let currentExp = 0;             // 当前总经验
    let currentSkill = null;        // 正在查看/答题的技能
    let skillData = null;           // 从内容包文件读到的完整数据
    let pendingReview = null;       // 待完成的抽检：{ skillName, deducted }
    let reviewsPassed = 0;          // 已经通过的抽检次数
    let reviewedNames = [];         // 最近复习过的技能队列（末尾最新）
    let bonusExp = 0;               // 进阶挑战额外经验
    let completedChallenges = new Set(); // 已完成的进阶挑战 key
    let currentChallengeKey = null; // 当前打开的进阶挑战 key
    let deckMode = false;           // 是否处于“刷卡学习”模式
    let deckItems = [];             // 当前刷卡队列
    let deckIndex = 0;              // 当前刷卡位置
    let currentPackId = null;       // 当前内容包 id
    let currentProgressKey = null;  // 当前内容包对应的 localStorage 键
    let packList = [];              // content/index.json 里的内容包清单
    let searchText = "";            // 当前搜索关键词
    let builderFields = [];         // 碎片式答题生成的数字输入框
    let builderChoices = [];        // 碎片式答题生成的符号选择组
    let reviewFields = [];          // 复习弹窗里的碎片数字输入框
    let reviewChoices = [];         // 复习弹窗里的碎片符号选择组
    let activeNumField = null;      // 当前被选中的数字框（小键盘往这里输入）
    let schemaAttemptsLeft = 3;     // 碎片式答题每次打开的尝试次数
    let schemaBlocked = false;      // 次数用完后是否禁止继续提交

    function progressKey(packId) {
      return PROGRESS_PREFIX + "." + packId;
    }

    // 把进度状态恢复到“什么都没有”的初始值
    function resetProgressState() {
      completedNames = new Set();
      currentExp = 0;
      pendingReview = null;
      reviewsPassed = 0;
      reviewedNames = [];
      bonusExp = 0;
      completedChallenges = new Set();
      currentChallengeKey = null;
      deckMode = false;
      deckItems = [];
      deckIndex = 0;
    }

    // 从某个内容包自己的存储键读取进度
    function loadProgressFromKey(key) {
      resetProgressState();
      try {
        const saved = JSON.parse(localStorage.getItem(key));
        if (saved) {
          completedNames = new Set(saved.completed || []);
          currentExp = Number(saved.exp) || 0;
          reviewsPassed = Number(saved.reviewsPassed) || 0;
          pendingReview = saved.review || null;
          reviewedNames = Array.isArray(saved.reviewed) ? saved.reviewed : [];
          bonusExp = Number(saved.bonusExp) || 0;
          completedChallenges = new Set(saved.challengeCompleted || []);
        }
      } catch (error) {
        // 保存的数据坏了就当作没有进度，不影响使用
      }
    }

    function saveProgress() {
      if (!currentProgressKey) return;
      localStorage.setItem(
        currentProgressKey,
        JSON.stringify({
          completed: [...completedNames],
          exp: currentExp,
          reviewsPassed: reviewsPassed,
          review: pendingReview,
          reviewed: reviewedNames,
          bonusExp: bonusExp,
          challengeCompleted: [...completedChallenges]
        })
      );
    }

    // 把旧版“单一进度”迁移成 physics 内容包的进度（只做一次）
    function migrateLegacyPhysicsProgress() {
      const newKey = progressKey("physics");
      const legacy = localStorage.getItem(LEGACY_PHYSICS_KEY);
      if (legacy && !localStorage.getItem(newKey)) {
        localStorage.setItem(newKey, legacy);
        localStorage.removeItem(LEGACY_PHYSICS_KEY);
      }
    }

    // ===== 内容包选择与加载 =====
    function renderPackList() {
      const box = document.getElementById("pack-list");
      box.innerHTML = "";

      if (packList.length === 0) {
        const p = document.createElement("p");
        p.textContent = "还没有可用的内容包，请检查 content/index.json。";
        box.appendChild(p);
        return;
      }

      packList.forEach(pack => {
        const button = document.createElement("button");
        button.className = "pack-item";
        if (pack.status === "building") {
          button.disabled = true;
        }
        const name = document.createElement("strong");
        name.textContent = pack.name;
        const desc = document.createElement("span");
        desc.textContent = pack.description || "";
        button.appendChild(name);
        button.appendChild(desc);
        button.addEventListener("click", () => choosePack(pack));
        box.appendChild(button);
      });
    }

    function showPackPicker() {
      renderPackList();
      document.getElementById("pack-screen").classList.remove("hidden");
    }

    function choosePack(pack) {
      // 切换前先关掉可能开着的弹窗
      hideDetail();
      closeReview();

      currentPackId = pack.id;
      currentProgressKey = progressKey(pack.id);

      if (pack.id === "physics") {
        migrateLegacyPhysicsProgress();
      }
      loadProgressFromKey(currentProgressKey);
      localStorage.setItem(LAST_PACK_KEY, pack.id);

      // 切换内容包时清空搜索框
      searchText = "";
      document.getElementById("search-input").value = "";
      document.getElementById("app-title").textContent = pack.name || "学习技能树";
      document.getElementById("pack-screen").classList.add("hidden");

      fetch(pack.file)
        .then(response => {
          if (!response.ok) throw new Error("找不到文件 " + pack.file);
          return response.json();
        })
        .then(data => {
          skillData = data;

          // 把所有技能拍平成一份清单，方便统计进度
          allSkills = [];
          data.chapters.forEach(chapter => {
            chapter.skills.forEach(skill => {
              allSkills.push(skill);
            });
          });
          totalExp = allSkills.reduce((sum, skill) => sum + skill.exp, 0);

          renderSkillTree(data);
          updateProgress();
          updateReviewBanner();
        })
        .catch(error => {
          document.getElementById("pack-screen").classList.remove("hidden");
          alert("内容包加载失败：" + error.message);
        });
    }

    // ===== 生成技能列表 =====
    function escapeRegExp(text) {
      return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    // 搜索结果里：把“命中关键词”的原文片段加到卡片下方，并高亮
    function appendSnippetToCard(card, skill, keyword) {
      let source = null;
      if (skill.name.toLowerCase().includes(keyword)) return; // 名字命中时无需说明
      if (skill.concept.toLowerCase().includes(keyword)) {
        source = skill.concept;
      } else if (skill.question.toLowerCase().includes(keyword)) {
        source = skill.question;
      } else {
        return;
      }

      const snippet = document.createElement("span");
      snippet.className = "match-snippet";
      snippet.appendChild(document.createTextNode("相关原文："));

      const lower = source.toLowerCase();
      const at = lower.indexOf(keyword);
      const start = Math.max(0, at - 24);
      const end = Math.min(source.length, at + keyword.length + 24);
      if (start > 0) snippet.appendChild(document.createTextNode("…"));

      const slice = source.slice(start, end);
      const pattern = new RegExp(escapeRegExp(keyword), "gi");
      let lastIndex = 0;
      let match;
      while ((match = pattern.exec(slice)) !== null) {
        snippet.appendChild(document.createTextNode(slice.slice(lastIndex, match.index)));
        const mark = document.createElement("mark");
        mark.textContent = match[0];
        snippet.appendChild(mark);
        lastIndex = match.index + match[0].length;
        if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
      }
      snippet.appendChild(document.createTextNode(slice.slice(lastIndex)));

      if (end < source.length) snippet.appendChild(document.createTextNode("…"));
      card.appendChild(snippet);
    }

    function appendSkillCard(list, skill, keyword) {
      const done = completedNames.has(skill.name);
      const card = document.createElement("div");
      card.className = "skill-card" + (done ? " done" : "");
      const badge = done ? '<span class="done-badge">✓ 已掌握</span>' : "";
      card.innerHTML = `<h2>${skill.name}${badge}</h2><p>经验值：${skill.exp}</p>`;
      if (keyword) appendSnippetToCard(card, skill, keyword);
      card.addEventListener("click", () => {
        deckMode = false;
        showDetail(skill);
      });
      list.appendChild(card);
    }

    function challengeKeyFor(chapterTitle, challengeName) {
      return chapterTitle + "::" + challengeName;
    }

    function appendChallengeCard(list, challenge, chapterTitle) {
      const key = challengeKeyFor(chapterTitle, challenge.name);
      const done = completedChallenges.has(key);
      const card = document.createElement("div");
      card.className = "skill-card challenge-card" + (done ? " done" : "");
      const badge = done ? '<span class="done-badge">✓ 已完成</span>' : "";
      card.innerHTML = `<h2>${challenge.name}${badge}</h2><p>进阶经验：${challenge.exp}</p>`;
      card.addEventListener("click", () => {
        deckMode = false;
        showDetail(challenge, true, chapterTitle);
      });
      list.appendChild(card);
    }

    // 给搜索匹配打分：名字直接命中 > 题目里出现 > 概念里提到
    function skillMatchScore(skill, keyword) {
      if (!keyword) return 0;
      const name = skill.name.toLowerCase();
      const question = skill.question.toLowerCase();
      const concept = skill.concept.toLowerCase();

      let score = 0;
      if (name === keyword) score += 100;
      else if (name.includes(keyword)) score += 50;
      if (question.includes(keyword)) score += 10;
      if (concept.includes(keyword)) score += 1;
      return score;
    }

    function renderSkillTree(data) {
      const list = document.getElementById("skill-list");
      list.innerHTML = "";

      const keyword = searchText.trim().toLowerCase();
      let shownCount = 0;

      if (keyword === "") {
        // 无搜索时：按章节分组展示
        data.chapters.forEach(chapter => {
          const title = document.createElement("h2");
          title.className = "chapter-title";
          title.textContent = chapter.title;
          list.appendChild(title);

          if (chapter.skills && chapter.skills.length > 0) {
            const deckButton = document.createElement("button");
            deckButton.className = "deck-start-btn";
            deckButton.textContent = `▶ 开始学习本章（${chapter.skills.length} 张）`;
            deckButton.addEventListener("click", () => startDeck(chapter));
            list.appendChild(deckButton);
          }

          chapter.skills.forEach(skill => {
            appendSkillCard(list, skill);
            shownCount += 1;
          });

          const challenges = Array.isArray(chapter.challenges) ? chapter.challenges : [];
          if (challenges.length > 0) {
            const challengeHeading = document.createElement("h3");
            challengeHeading.className = "challenge-title";
            challengeHeading.textContent = "⚡ 进阶挑战（可选）";
            list.appendChild(challengeHeading);
            challenges.forEach(challenge => {
              appendChallengeCard(list, challenge, chapter.title);
              shownCount += 1;
            });
          }
        });
      } else {
        // 搜索时：跨章节汇总，先按“名称相关/内容提及”分组，组内再排序
        const matches = [];
        data.chapters.forEach(chapter => {
          chapter.skills.forEach(skill => {
            const score = skillMatchScore(skill, keyword);
            if (score > 0) {
              matches.push({ skill, score });
            }
          });
        });

        const nameHits = matches
          .filter(item => item.score >= 50)
          .sort((a, b) => {
            const aName = a.skill.name.toLowerCase();
            const bName = b.skill.name.toLowerCase();
            const aRank = aName === keyword ? 0 : aName.startsWith(keyword) ? 1 : 2;
            const bRank = bName === keyword ? 0 : bName.startsWith(keyword) ? 1 : 2;
            if (aRank !== bRank) return aRank - bRank;
            return 0;
          });
        const contentHits = matches
          .filter(item => item.score < 50)
          .sort((a, b) => b.score - a.score);

        if (nameHits.length > 0) {
          const title = document.createElement("h2");
          title.className = "chapter-title";
          title.textContent = `名称相关（${nameHits.length}）`;
          list.appendChild(title);
        }
        nameHits.forEach(item => {
          appendSkillCard(list, item.skill, keyword);
          shownCount += 1;
        });

        if (contentHits.length > 0) {
          const title = document.createElement("h2");
          title.className = "chapter-title";
          title.textContent = `内容提及（${contentHits.length}）`;
          list.appendChild(title);
        }
        contentHits.forEach(item => {
          appendSkillCard(list, item.skill, keyword);
          shownCount += 1;
        });
      }

      if (shownCount === 0) {
        const empty = document.createElement("p");
        empty.className = "small-muted";
        empty.textContent = keyword === ""
          ? "这个内容包还没有技能。"
          : `没有找到与“${searchText.trim()}”相关的技能。`;
        list.appendChild(empty);
      }

      updatePackReviewButton();
    }

    function updateProgress() {
      const doneCount = allSkills.filter(skill => completedNames.has(skill.name)).length;
      let text = `已完成 ${doneCount} / ${allSkills.length} · 当前经验 ${currentExp} / ${totalExp}`;

      // 进阶挑战统计（只统计，不混入主线）
      if (skillData) {
        let challengeTotal = 0;
        let challengeDone = 0;
        skillData.chapters.forEach(chapter => {
          (chapter.challenges || []).forEach(challenge => {
            challengeTotal += 1;
            const key = challengeKeyFor(chapter.title, challenge.name);
            if (completedChallenges.has(key)) challengeDone += 1;
          });
        });
        if (challengeTotal > 0) {
          text += ` · 进阶 ${challengeDone}/${challengeTotal} · 附加 +${bonusExp}`;
        }
      }

      document.getElementById("progress-text").textContent = text;

      const percent = totalExp > 0 ? Math.min(100, (currentExp / totalExp) * 100) : 0;
      document.getElementById("progress-fill").style.width = percent + "%";
    }

    // ===== 详情弹窗的两个步骤 =====
    function renderDetailSections(skill) {
      const container = document.getElementById("detail-sections");
      container.innerHTML = "";

      const sections = Array.isArray(skill.sections) ? skill.sections : [];
      sections.forEach(section => {
        const box = document.createElement("div");
        box.className = "detail-section";

        const heading = document.createElement("h4");
        heading.textContent = section.heading;
        box.appendChild(heading);

        if (section.body) {
          const p = document.createElement("p");
          p.textContent = section.body;
          box.appendChild(p);
        }
        if (Array.isArray(section.points)) {
          const ul = document.createElement("ul");
          section.points.forEach(point => {
            const li = document.createElement("li");
            li.textContent = point;
            ul.appendChild(li);
          });
          box.appendChild(ul);
        }
        container.appendChild(box);
      });
    }

    function updateDeckHeader() {
      const header = document.getElementById("deck-header");
      if (!deckMode || deckItems.length <= 1) {
        header.classList.add("hidden");
        return;
      }
      header.classList.remove("hidden");
      document.getElementById("deck-progress").textContent =
        `第 ${deckIndex + 1} / ${deckItems.length} 张`;
      document.getElementById("deck-prev-btn").disabled = deckIndex <= 0;
      document.getElementById("deck-next-btn").disabled = deckIndex >= deckItems.length - 1;
    }

    function startDeck(chapter) {
      if (!chapter.skills || chapter.skills.length === 0) return;
      deckItems = chapter.skills.slice();
      deckIndex = 0;
      deckMode = true;
      showDetail(deckItems[0]);
    }

    function deckGo(delta) {
      const next = deckIndex + delta;
      if (next < 0 || next >= deckItems.length) return;
      deckIndex = next;
      showDetail(deckItems[next]);
    }

    function exitDeck() {
      deckMode = false;
      deckItems = [];
      deckIndex = 0;
      hideDetail();
    }

    function updatePackReviewButton() {
      const button = document.getElementById("pack-review-btn");
      const masteredCount = allSkills.filter(skill => completedNames.has(skill.name)).length;
      if (masteredCount > 0 && skillData) {
        button.textContent = `▶ 复习本包已掌握技能（${masteredCount} 张）`;
        button.classList.remove("hidden");
      } else {
        button.classList.add("hidden");
      }
    }

    function startPackDeck() {
      const pool = allSkills.filter(skill => completedNames.has(skill.name));
      if (pool.length === 0) {
        alert("还没有已掌握的技能，先完成几张卡再来复习吧。");
        return;
      }
      deckItems = pool;
      deckIndex = 0;
      deckMode = true;
      showDetail(deckItems[0]);
    }

    function showDetail(skill, isChallenge, chapterTitle) {
      currentSkill = skill;
      currentChallengeKey = isChallenge && chapterTitle
        ? challengeKeyFor(chapterTitle, skill.name)
        : null;

      document.getElementById("detail-name").textContent = skill.name;
      if (currentChallengeKey) {
        document.getElementById("detail-exp").textContent = completedChallenges.has(currentChallengeKey)
          ? `进阶经验：${skill.exp}（已完成 ✓）`
          : `进阶经验：${skill.exp}（挑战成功可获得）`;
      } else {
        document.getElementById("detail-exp").textContent = completedNames.has(skill.name)
          ? `经验值：${skill.exp}（已掌握 ✓）`
          : `经验值：${skill.exp}（答对可获得）`;
      }
      document.getElementById("detail-concept").textContent = skill.concept;
      document.getElementById("detail-question").textContent = skill.question;
      renderDetailSections(skill);

      // 可选示意图：数据里配了 conceptFigure / questionFigure 才显示
      const conceptFigure = document.getElementById("concept-figure");
      if (skill.conceptFigure) {
        conceptFigure.src = skill.conceptFigure;
        conceptFigure.classList.remove("hidden");
      } else {
        conceptFigure.removeAttribute("src");
        conceptFigure.classList.add("hidden");
      }
      const questionFigure = document.getElementById("question-figure");
      if (skill.questionFigure) {
        questionFigure.src = skill.questionFigure;
        questionFigure.classList.remove("hidden");
      } else {
        questionFigure.removeAttribute("src");
        questionFigure.classList.add("hidden");
      }

      // 每次打开都回到第 1 步（概念），并清空上次的答题状态
      document.getElementById("concept-step").classList.remove("hidden");
      document.getElementById("quiz-step").classList.add("hidden");
      document.getElementById("answer-input").value = "";
      document.getElementById("answer-builder").innerHTML = "";
      builderFields = [];
      builderChoices = [];
      activeNumField = null;
      schemaAttemptsLeft = 3;
      schemaBlocked = false;
      setFeedback("", "");
      document.getElementById("show-answer-btn").classList.add("hidden");
      document.getElementById("answer-reveal").classList.add("hidden");

      updateDeckHeader();
      document.getElementById("detail-name").classList.toggle("deck-title", deckMode);
      document
        .querySelector("#detail-overlay .detail-box")
        .classList.toggle("deck-active", deckMode);
      if (deckMode) {
        const isLast = deckIndex >= deckItems.length - 1;
        document.getElementById("quiz-done-btn").textContent = isLast ? "完成本章" : "下一张 →";
      } else {
        document.getElementById("quiz-done-btn").textContent = "完成";
      }
      document.getElementById("detail-overlay").classList.remove("hidden");
    }

    function hideDetail() {
      document.getElementById("detail-overlay").classList.add("hidden");
      currentSkill = null;
      currentChallengeKey = null;
    }

    function showQuizStep() {
      document.getElementById("concept-step").classList.add("hidden");
      document.getElementById("quiz-step").classList.remove("hidden");

      const schema = currentSkill.answerSchema;
      const useBuilder = Array.isArray(schema) && schema.length > 0;
      const hasNumberFields = useBuilder && schema.some(part => part.type === "number");

      document.getElementById("builder-answer-area").classList.toggle("hidden", !useBuilder);
      document.getElementById("text-answer-area").classList.toggle("hidden", useBuilder);
      document.getElementById("answer-keypad").classList.toggle("hidden", !hasNumberFields);

      if (useBuilder) {
        schemaAttemptsLeft = 3;
        schemaBlocked = false;
        renderAnswerBuilder(schema);
        document.getElementById("submit-btn").classList.remove("hidden");
        document.getElementById("quiz-done-btn").classList.add("hidden");
        if (builderFields[0]) {
          setActiveNumField(builderFields[0]);
          builderFields[0].focus();
        }
      } else {
        document.getElementById("submit-btn").classList.remove("hidden");
        document.getElementById("quiz-done-btn").classList.add("hidden");
        document.getElementById("answer-input").focus();
      }
    }

    function showConceptStep() {
      document.getElementById("quiz-step").classList.add("hidden");
      document.getElementById("concept-step").classList.remove("hidden");
    }

    function setFeedback(text, kind) {
      const el = document.getElementById("feedback");
      el.textContent = text;
      el.className = kind === "ok" ? "feedback-ok" : kind === "err" ? "feedback-err" : "";
    }

    // ===== 碎片式答题（answerSchema） =====
    function setActiveNumField(field) {
      if (activeNumField) activeNumField.classList.remove("active");
      activeNumField = field;
      if (activeNumField) activeNumField.classList.add("active");
    }

    function buildAnswerUI(schema, container, submitHandler) {
      container.innerHTML = "";
      const fields = [];
      const choices = [];

      schema.forEach(part => {
        if (part.type === "label") {
          const span = document.createElement("span");
          span.className = "builder-label";
          span.textContent = part.text;
          container.appendChild(span);
        } else if (part.type === "break") {
          const br = document.createElement("span");
          br.className = "builder-break";
          container.appendChild(br);
        } else if (part.type === "number") {
          const input = document.createElement("input");
          input.className = "num-field";
          input.type = "text";
          input.inputMode = "decimal";
          input.placeholder = "?";
          input.autocomplete = "off";
          input.dataset.expected = String(part.expected);

          // 只允许出现数字、小数点、减号和科学计数法 e/E
          input.addEventListener("input", () => {
            input.value = input.value.replace(/[^0-9.eE\-]/g, "");
          });
          input.addEventListener("focus", () => setActiveNumField(input));
          input.addEventListener("keydown", event => {
            if (event.key === "Enter" && submitHandler) submitHandler();
          });

          fields.push(input);
          container.appendChild(input);
        } else if (part.type === "choice") {
          const group = document.createElement("span");
          group.className = "choice-group";
          group.dataset.expected = part.expected;

          // 每次打开都随机排列选项，避免记住位置
          const shuffled = [...part.options];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }

          shuffled.forEach(option => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "choice-chip";
            chip.textContent = option;
            chip.addEventListener("click", () => {
              group.querySelectorAll(".choice-chip").forEach(item => {
                item.classList.remove("selected");
              });
              chip.classList.add("selected");
              group.dataset.selected = option;
            });
            group.appendChild(chip);
          });

          choices.push(group);
          container.appendChild(group);
        }
      });

      return { fields, choices };
    }

    function renderAnswerBuilder(schema) {
      const result = buildAnswerUI(
        schema,
        document.getElementById("answer-builder"),
        handleSubmit
      );
      builderFields = result.fields;
      builderChoices = result.choices;
    }

    function handleKeypad(key) {
      if (!activeNumField) {
        setFeedback("请先点击或选中一个要填的空格。", "err");
        return;
      }

      let value = activeNumField.value;

      if (key === "clear") {
        value = "";
      } else if (key === "minus") {
        // 减号：在正负之间切换
        value = value.startsWith("-") ? value.slice(1) : "-" + value;
      } else if (key === ".") {
        if (!value.includes(".")) {
          value = value === "" || value === "-" ? value + "0." : value + ".";
        }
      } else {
        value += key;
      }

      activeNumField.value = value;
    }

    function numbersCloseEnough(got, expected) {
      if (Number.isNaN(got) || Number.isNaN(expected)) return false;
      // 允许 2% 的相对误差；对接近 0 的数给 0.05 的绝对误差
      const tolerance = Math.max(Math.abs(expected) * 0.02, 0.05);
      return Math.abs(got - expected) <= tolerance;
    }

    function handleSchemaSubmit() {
      if (schemaBlocked) {
        setFeedback("这次打开的 3 次机会已经用完，请返回概念再读一遍后重新挑战。", "err");
        return;
      }

      const blankCount = builderFields.filter(field => field.value.trim() === "").length;
      if (blankCount > 0) {
        setFeedback(`还有 ${blankCount} 个空格没填，先点空格，再用小键盘或键盘输入数字。`, "err");
        return;
      }

      const unselectedCount = builderChoices.filter(group => !group.dataset.selected).length;
      if (unselectedCount > 0) {
        setFeedback(`还有 ${unselectedCount} 组符号碎片没选，点一下正确的符号。`, "err");
        return;
      }

      const allCorrect = builderFields.every(field => {
        const got = parseFloat(field.value);
        const expected = parseFloat(field.dataset.expected);
        return numbersCloseEnough(got, expected);
      }) && builderChoices.every(group => group.dataset.selected === group.dataset.expected);

      if (allCorrect) {
        markAnswerCorrect();
      } else {
        schemaAttemptsLeft -= 1;
        if (schemaAttemptsLeft <= 0) {
          schemaBlocked = true;
          setFeedback("3 次机会用完了。请返回概念再读一遍，重新打开这道题后再挑战。", "err");
        } else {
          setFeedback(
            `结果不对，还有 ${schemaAttemptsLeft} 次机会。再检查一下每个空格。`,
            "err"
          );
        }
      }
    }

    // 答对后统一处理：加经验、更新页面、触发复习抽检
    function markAnswerCorrect() {
      if (currentChallengeKey) {
        if (completedChallenges.has(currentChallengeKey)) {
          setFeedback("回答正确！这个挑战你已完成，练习不再重复加分。", "ok");
        } else {
          completedChallenges.add(currentChallengeKey);
          bonusExp += currentSkill.exp;
          saveProgress();
          setFeedback(`挑战成功！获得附加经验 ${currentSkill.exp} ⚡`, "ok");
          renderSkillTree(skillData);
          updateProgress();
        }
      } else if (completedNames.has(currentSkill.name)) {
        setFeedback("回答正确！这个技能你已掌握，练习不再重复加分。", "ok");
      } else {
        completedNames.add(currentSkill.name);
        currentExp += currentSkill.exp;
        saveProgress();
        setFeedback(`回答正确！获得 ${currentSkill.exp} 经验 🎉`, "ok");
        renderSkillTree(skillData);
        updateProgress();

        // 每完成 3 个技能触发一次复习抽检（如果上一次抽检还没完成，就不打断，顶部横幅会提醒）
        if (!pendingReview) {
          startReviewIfDue(currentSkill.name);
        }
      }
      // 答对后：隐藏“提交答案”，显示“完成”，方便直接退出
      document.getElementById("submit-btn").classList.add("hidden");
      document.getElementById("quiz-done-btn").classList.remove("hidden");
      document.getElementById("show-answer-btn").classList.add("hidden");
      document.getElementById("answer-reveal").classList.add("hidden");
    }

    // 把答案转成方便比较的形式：去掉空格、统一大小写和中文标点
    function normalizeAnswer(text) {
      return text
        .toLowerCase()
        .replace(/[\s\u3000]+/g, "")
        .replace(/\u2212/g, "-") // 把数学减号 − 也当作普通减号 -
        .replace(/（/g, "(")
        .replace(/）/g, ")")
        .replace(/，/g, ",")
        .replace(/。/g, ".")
        .replace(/；/g, ";");
    }

    function handleSubmit() {
      if (!currentSkill) return;

      // 配置了 answerSchema 的题目走碎片式判题
      if (Array.isArray(currentSkill.answerSchema) && currentSkill.answerSchema.length > 0) {
        handleSchemaSubmit();
        return;
      }

      const input = document.getElementById("answer-input").value.trim();
      if (input === "") {
        setFeedback("请先输入答案再提交。", "err");
        return;
      }

      const isCorrect = normalizeAnswer(input) === normalizeAnswer(currentSkill.answer);

      if (isCorrect) {
        markAnswerCorrect();
      } else {
        setFeedback("还不对哦，再想想；也可以返回概念再读一遍。", "err");
        document.getElementById("show-answer-btn").classList.remove("hidden");
      }
    }

    // ===== 复习抽检 =====
    function setReviewFeedback(text, kind) {
      const el = document.getElementById("review-feedback");
      el.textContent = text;
      el.className = kind === "ok" ? "feedback-ok" : kind === "err" ? "feedback-err" : "";
    }

    function updateReviewBanner() {
      const banner = document.getElementById("review-banner");
      const text = document.getElementById("review-banner-text");

      if (!pendingReview) {
        banner.classList.add("hidden");
        return;
      }

      const skill = allSkills.find(item => item.name === pendingReview.skillName);
      const skillName = skill ? skill.name : "旧技能";
      text.textContent = pendingReview.deducted > 0
        ? `复习待完成：${skillName}（已被扣 ${pendingReview.deducted} 经验，答对可恢复）`
        : `复习待完成：${skillName}（凭记忆答对，否则会扣经验）`;
      banner.classList.remove("hidden");
    }

    function findSkillByName(name) {
      return allSkills.find(item => item.name === name);
    }

    function pickReviewSkill(excludeName) {
      // 优先从“其他旧技能”里抽，万一只有它一个，也允许抽它
      let pool = allSkills.filter(skill =>
        completedNames.has(skill.name) && skill.name !== excludeName
      );
      if (pool.length === 0) {
        pool = allSkills.filter(skill => completedNames.has(skill.name));
      }
      if (pool.length === 0) return null;

      // 优先抽“从未被抽过”的技能；全部抽过一轮后，从最久没复习的开始
      const neverReviewed = pool.filter(skill => !reviewedNames.includes(skill.name));
      if (neverReviewed.length > 0) {
        return neverReviewed[Math.floor(Math.random() * neverReviewed.length)];
      }

      const oldest = [...pool].sort((a, b) => {
        return reviewedNames.indexOf(a.name) - reviewedNames.indexOf(b.name);
      });
      return oldest[0];
    }

    function startReviewIfDue(excludeName) {
      // 已有待完成的抽检就不重复触发（横幅会提醒用户）
      if (pendingReview) return;

      const completedCount = allSkills.filter(skill => completedNames.has(skill.name)).length;
      const dueCount = Math.floor(completedCount / 3) - reviewsPassed;
      if (dueCount <= 0) return;

      const skill = pickReviewSkill(excludeName);
      if (!skill) return;

      pendingReview = { skillName: skill.name, deducted: 0 };
      saveProgress();
      openReview();
    }

    function openReview() {
      if (!pendingReview) return;

      const skill = findSkillByName(pendingReview.skillName);
      if (!skill) {
        // 被抽的技能已经从数据里删掉：本次抽检作废，避免卡死
        pendingReview = null;
        saveProgress();
        updateReviewBanner();
        return;
      }

      const deduct = Math.max(1, Math.round(skill.exp * 0.2));
      const hasReviewQuestion = Boolean(skill.reviewQuestion);
      document.getElementById("review-note").textContent =
        `抽到旧技能「${skill.name}」（价值 ${skill.exp} 经验）` +
        (pendingReview.deducted > 0 ? `。目前已扣 ${pendingReview.deducted} 经验，答对可恢复。` : `。答错会扣约 ${deduct} 经验。`) +
        (hasReviewQuestion ? "" : "（该技能暂未配置独立复习题，暂用原题）");

      document.getElementById("review-question").textContent = hasReviewQuestion
        ? skill.reviewQuestion
        : skill.question;
      document.getElementById("review-input").value = "";

      const reviewSchema = skill.reviewAnswerSchema;
      const useReviewBuilder = Array.isArray(reviewSchema) && reviewSchema.length > 0;
      const hasReviewNumberFields = useReviewBuilder && reviewSchema.some(part => part.type === "number");

      document.getElementById("review-builder-answer-area").classList.toggle("hidden", !useReviewBuilder);
      document.getElementById("review-text-answer-area").classList.toggle("hidden", useReviewBuilder);
      document.getElementById("review-keypad").classList.toggle("hidden", !hasReviewNumberFields);

      setActiveNumField(null);
      if (useReviewBuilder) {
        const result = buildAnswerUI(
          reviewSchema,
          document.getElementById("review-answer-builder"),
          handleReviewSubmit
        );
        reviewFields = result.fields;
        reviewChoices = result.choices;
        if (reviewFields[0]) {
          setActiveNumField(reviewFields[0]);
          reviewFields[0].focus();
        }
      }

      setReviewFeedback("", "");
      document.getElementById("review-done-btn").classList.add("hidden");
      document.getElementById("review-submit-btn").classList.remove("hidden");
      document.getElementById("review-skip-btn").classList.remove("hidden");
      document.getElementById("review-overlay").classList.remove("hidden");
      if (!useReviewBuilder) {
        document.getElementById("review-input").focus();
      }
      updateReviewBanner();
    }

    function closeReview() {
      document.getElementById("review-overlay").classList.add("hidden");
    }

    // 检查一组碎片答案：空格数、未选的符号组数、整体是否正确
    function checkAnswerParts(fields, choices) {
      const blank = fields.filter(field => field.value.trim() === "").length;
      const unselected = choices.filter(group => !group.dataset.selected).length;
      const correct =
        blank === 0 &&
        unselected === 0 &&
        fields.every(field => {
          return numbersCloseEnough(parseFloat(field.value), parseFloat(field.dataset.expected));
        }) &&
        choices.every(group => group.dataset.selected === group.dataset.expected);
      return { blank, unselected, correct };
    }

    function handleReviewSubmit() {
      if (!pendingReview) return;

      const skill = findSkillByName(pendingReview.skillName);
      if (!skill) return;

      // 复习题配置了 reviewAnswerSchema 时，走碎片式判题
      const reviewSchema = skill.reviewAnswerSchema;
      if (Array.isArray(reviewSchema) && reviewSchema.length > 0) {
        handleReviewSchemaSubmit(skill);
        return;
      }

      const input = document.getElementById("review-input").value.trim();
      if (input === "") {
        setReviewFeedback("请先输入答案再提交。", "err");
        return;
      }

      const referenceAnswer = skill.reviewAnswer || skill.answer;
      const isCorrect = normalizeAnswer(input) === normalizeAnswer(referenceAnswer);
      if (isCorrect) {
        passReview(skill);
      } else {
        failReview(skill);
      }
    }

    function handleReviewSchemaSubmit(skill) {
      const result = checkAnswerParts(reviewFields, reviewChoices);

      if (result.blank > 0) {
        setReviewFeedback(`还有 ${result.blank} 个空格没填，先点空格再输入数字。`, "err");
        return;
      }
      if (result.unselected > 0) {
        setReviewFeedback(`还有 ${result.unselected} 组符号碎片没选，点一下正确的符号。`, "err");
        return;
      }

      if (result.correct) {
        passReview(skill);
      } else {
        failReview(skill);
      }
    }

    function passReview() {
      let message = "复习通过！没有扣分，继续保持 🎉";
      if (pendingReview.deducted > 0) {
        currentExp += pendingReview.deducted;
        message = `复习通过！已恢复被扣的 ${pendingReview.deducted} 经验 🎉`;
      }

      // 把这个技能移到“最近复习队列”末尾（去重）
      const passedName = pendingReview.skillName;
      reviewedNames = reviewedNames.filter(name => name !== passedName);
      reviewedNames.push(passedName);

      pendingReview = null;
      reviewsPassed += 1;
      saveProgress();

      setReviewFeedback(message, "ok");
      document.getElementById("review-done-btn").classList.remove("hidden");
      document.getElementById("review-submit-btn").classList.add("hidden");
      document.getElementById("review-skip-btn").classList.add("hidden");
      renderSkillTree(skillData);
      updateProgress();
      updateReviewBanner();
    }

    function failReview(skill) {
      if (pendingReview.deducted === 0) {
        const deduct = Math.max(1, Math.round(skill.exp * 0.2));
        pendingReview.deducted = deduct;
        currentExp = Math.max(0, currentExp - deduct);
        saveProgress();
        setReviewFeedback(`答错了，被扣 ${deduct} 经验。再答对一次就能恢复。`, "err");
        updateProgress();
        updateReviewBanner();
      } else {
        setReviewFeedback(
          `还是不对，目前已被扣 ${pendingReview.deducted} 经验，答对可恢复。`,
          "err"
        );
      }
    }

    function finishReviewAndContinue() {
      closeReview();
      // 收掉下面可能还开着的答题窗口，直接回到技能列表
      exitDeck();
      // 如果在这期间又攒够了新的抽检次数，继续抽下一个
      startReviewIfDue();
    }

    function handleDoneClick() {
      if (deckMode) {
        if (deckIndex < deckItems.length - 1) {
          deckGo(1);
        } else {
          exitDeck();
        }
      } else {
        hideDetail();
      }
    }

    // ===== 重置进度 =====
    function resetProgress() {
      const confirmed = window.confirm("确定要清空所有学习进度吗？此操作无法撤销。");
      if (!confirmed) return;

      completedNames.clear();
      currentExp = 0;
      pendingReview = null;
      reviewsPassed = 0;
      reviewedNames = [];
      bonusExp = 0;
      completedChallenges.clear();
      currentChallengeKey = null;
      saveProgress();

      // 如果正好有弹窗开着，先关掉
      hideDetail();
      closeReview();

      renderSkillTree(skillData);
      updateProgress();
      updateReviewBanner();
    }

    // ===== 按钮事件 =====
    document.getElementById("start-quiz-btn").addEventListener("click", showQuizStep);
    document.getElementById("back-btn").addEventListener("click", showConceptStep);
    document.getElementById("submit-btn").addEventListener("click", handleSubmit);
    document.getElementById("quiz-done-btn").addEventListener("click", handleDoneClick);
    document.getElementById("answer-input").addEventListener("keydown", event => {
      if (event.key === "Enter") handleSubmit();
    });
    document.getElementById("close-btn").addEventListener("click", () => {
      if (deckMode) exitDeck();
      else hideDetail();
    });
    document.getElementById("reset-btn").addEventListener("click", resetProgress);
    document.getElementById("switch-pack-btn").addEventListener("click", showPackPicker);

    document.getElementById("deck-prev-btn").addEventListener("click", () => deckGo(-1));
    document.getElementById("deck-next-btn").addEventListener("click", () => deckGo(1));
    document.getElementById("pack-review-btn").addEventListener("click", startPackDeck);

    // 搜索框：输入即过滤当前内容包
    document.getElementById("search-input").addEventListener("input", event => {
      searchText = event.target.value;
      if (skillData) renderSkillTree(skillData);
    });

    // 小键盘：点击后把内容写进当前选中的数字框
    document.querySelectorAll(".keypad button").forEach(button => {
      button.addEventListener("click", () => handleKeypad(button.dataset.key));
    });

    document.getElementById("show-answer-btn").addEventListener("click", () => {
      document.getElementById("detail-answer").textContent = currentSkill.answer;
      document.getElementById("answer-reveal").classList.remove("hidden");
      document.getElementById("show-answer-btn").classList.add("hidden");
    });

    // 点击图片放大预览，点击任意处关闭
    function openImagePreview(src) {
      if (!src) return;
      document.getElementById("image-preview-img").src = src;
      document.getElementById("image-preview").classList.remove("hidden");
    }
    document.getElementById("concept-figure").addEventListener("click", event => {
      openImagePreview(event.currentTarget.getAttribute("src"));
    });
    document.getElementById("question-figure").addEventListener("click", event => {
      openImagePreview(event.currentTarget.getAttribute("src"));
    });
    document.getElementById("image-preview").addEventListener("click", () => {
      document.getElementById("image-preview").classList.add("hidden");
      document.getElementById("image-preview-img").removeAttribute("src");
    });

    document.getElementById("review-submit-btn").addEventListener("click", handleReviewSubmit);
    document.getElementById("review-input").addEventListener("keydown", event => {
      if (event.key === "Enter") handleReviewSubmit();
    });
    document.getElementById("review-skip-btn").addEventListener("click", closeReview);
    document.getElementById("review-close-btn").addEventListener("click", closeReview);
    document.getElementById("review-done-btn").addEventListener("click", finishReviewAndContinue);
    document.getElementById("review-banner-btn").addEventListener("click", openReview);

    // ===== 启动：读内容包索引 → 自动进入上次使用的内容包 =====
    fetch("content/index.json")
      .then(response => response.json())
      .then(index => {
        packList = index.packs || [];
        renderPackList();

        const lastPackId = localStorage.getItem(LAST_PACK_KEY);
        const lastPack = packList.find(pack => pack.id === lastPackId);
        if (lastPack) {
          choosePack(lastPack);
        }
        // 如果没有“上次使用”的记录，就停留在选择页让用户自己选
      });
  