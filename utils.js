export function processTags(text) {
    if (!text) return "";
    return text
        .replace(/#Urgent/gi, '<span class="tag-urgent">#Urgent</span>')
        .replace(/#Delayed/gi, '<span class="tag-delayed">#Delayed</span>')
        .replace(/#Escalated/gi, '<span class="tag-escalated">#Escalated</span>')
        .replace(/#OnTime/gi, '<span class="tag-ontime">#OnTime</span>')
        .replace(/#Received/gi, '<span class="tag-received">#Received</span>')
        .replace(/#TPI/gi, '<span class="tag-tpi">#TPI</span>');
}