import { URI } from '../core/model/uri';
import markdownItRegex from 'markdown-it-regex';
import * as vscode from 'vscode';
import { FoamFeature } from '../types';
import { isNone } from '../utils';
import { Foam } from '../core/model/foam';
import { FoamWorkspace } from '../core/model/workspace';
import { Logger } from '../core/utils/log';

const ALIAS_DIVIDER_CHAR = '|';
const refsStack: string[] = [];

const feature: FoamFeature = {
  activate: async (
    _context: vscode.ExtensionContext,
    foamPromise: Promise<Foam>
  ) => {
    const foam = await foamPromise;

    return {
      extendMarkdownIt: (md: markdownit) => {
        return [
          markdownItWithFoamTags,
          markdownItWithNoteInclusion,
          markdownItWithFoamLinks,
          markdownItWithRemoveLinkReferences,
        ].reduce((acc, extension) => extension(acc, foam.workspace), md);
      },
    };
  },
};

export const markdownItWithNoteInclusion = (
  md: markdownit,
  workspace: FoamWorkspace
) => {
  return md.use(markdownItRegex, {
    name: 'include-notes',
    regex: /!\[\[([^[\]]+?)\]\]/,
    replace: (wikilink: string) => {
      try {
        const includedNote = workspace.find(wikilink);

        if (!includedNote) {
          return `![[${wikilink}]]`;
        }

        const cyclicLinkDetected = refsStack.includes(wikilink);

        if (!cyclicLinkDetected) {
          refsStack.push(wikilink.toLowerCase());
        }

        const html = cyclicLinkDetected
          ? `<div class="foam-cyclic-link-warning">Cyclic link detected for wikilink: ${wikilink}</div>`
          : md.render(includedNote.source.text);

        if (!cyclicLinkDetected) {
          refsStack.pop();
        }

        return html;
      } catch (e) {
        Logger.error(
          `Error while including [[${wikilink}]] into the current document of the Preview panel`,
          e
        );
        return '';
      }
    },
  });
};

export const markdownItWithFoamLinks = (
  md: markdownit,
  workspace: FoamWorkspace
) => {
  return md.use(markdownItRegex, {
    name: 'connect-wikilinks',
    regex: /\[\[([^[\]]+?)\]\]/,
    replace: (wikilink: string) => {
      try {
        const linkHasAlias = wikilink.includes(ALIAS_DIVIDER_CHAR);
        const resourceLink = linkHasAlias
          ? wikilink.substring(0, wikilink.indexOf('|'))
          : wikilink;

        const resource = workspace.find(resourceLink);
        if (isNone(resource)) {
          return getPlaceholderLink(resourceLink);
        }

        const linkLabel = linkHasAlias
          ? wikilink.substr(wikilink.indexOf('|') + 1)
          : wikilink;

        return `<a class='foam-note-link' title='${
          resource.title
        }' href='${URI.toFsPath(resource.uri)}' data-href='${URI.toFsPath(
          resource.uri
        )}'>${linkLabel}</a>`;
      } catch (e) {
        Logger.error(
          `Error while creating link for [[${wikilink}]] in Preview panel`,
          e
        );
        return getPlaceholderLink(wikilink);
      }
    },
  });
};

const getPlaceholderLink = (content: string) =>
  `<a class='foam-placeholder-link' title="Link to non-existing resource" href="javascript:void(0);">${content}</a>`;

export const markdownItWithFoamTags = (
  md: markdownit,
  workspace: FoamWorkspace
) => {
  return md.use(markdownItRegex, {
    name: 'foam-tags',
    regex: /(#\w+)/,
    replace: (tag: string) => {
      try {
        const resource = workspace.find(tag);
        if (isNone(resource)) {
          return getFoamTag(tag);
        }
      } catch (e) {
        Logger.error(
          `Error while creating link for ${tag} in Preview panel`,
          e
        );
        return getFoamTag(tag);
      }
    },
  });
};

const getFoamTag = (content: string) =>
  `<span class='foam-tag'>${content}</span>`;

export const markdownItWithRemoveLinkReferences = (
  md: markdownit,
  workspace: FoamWorkspace
) => {
  // Forget about reference links that contain an alias divider
  md.inline.ruler.before('link', 'clear-references', state => {
    if (state.env.references) {
      Object.keys(state.env.references).forEach(refKey => {
        if (refKey.includes(ALIAS_DIVIDER_CHAR)) {
          delete state.env.references[refKey];
        }
      });
    }
    return false;
  });
  return md;
};

export default feature;
