(function () {
  function formatNumber(value) {
    if (typeof value !== "number" || Number.isNaN(value)) return "0";
    return value.toFixed(2).replace(/^0/, "").replace(/0+$/, "").replace(/\.$/, "");
  }

  function safeLine(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function toScroll(state) {
    const lines = ["colaPreflight", ` mode ${state.mode}`];

    if (state.image.fileName) lines.push(` imageName ${safeLine(state.image.fileName)}`);

    if (state.mode === "reviewer") {
      lines.push(" application");
      Object.entries(state.applicationData).forEach(([key, value]) => {
        lines.push(`  ${key} ${safeLine(value)}`);
      });
    }

    state.fields.forEach((field) => {
      lines.push(` field ${field.id}`);
      if (state.mode === "reviewer") {
        lines.push(`  applicationValue ${safeLine(field.applicationValue)}`);
        lines.push(`  labelValue ${safeLine(field.userValue || field.aiValue)}`);
      } else {
        lines.push(`  value ${safeLine(field.userValue || field.aiValue)}`);
      }
      lines.push(`  status ${field.status}`);
      lines.push(`  confidence ${formatNumber(field.confidence)}`);
      if (field.message) lines.push(`  issue ${safeLine(field.message)}`);
      if (field.suggestion) lines.push(`  suggestion ${safeLine(field.suggestion)}`);
      if (field.reviewerAction) lines.push(`  action ${field.reviewerAction}`);
      if (field.generatedReason) lines.push(`  reason ${safeLine(field.generatedReason)}`);
      if (field.box) {
        lines.push(
          `  box ${formatNumber(field.box.x)} ${formatNumber(field.box.y)} ${formatNumber(field.box.w)} ${formatNumber(field.box.h)}`,
        );
      }
    });

    return lines.join("\n");
  }

  window.toScroll = toScroll;
})();
